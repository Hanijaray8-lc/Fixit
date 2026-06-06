import express from "express";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/UserModels.js";
import Otp from "../models/Otp.js";
import { sendEmail, transporter } from "../utils/emailService.js";
import whatsappClient from "../whatsapp.js";

dotenv.config();

const router = express.Router();

// Shims for backward compatibility if other modules import them directly from otpRoutes
export { sendEmail, transporter };
export const otpStore = new Map(); // Empty map shim

// SEND OTP ROUTE
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  console.log("👉 [OTP Request] Starting API request for send-otp");
  try {
    if (!email) {
      console.log("❌ [OTP Error] Email is missing in request body");
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const cleanEmail = email.trim().toLowerCase();
    console.log("📨 [OTP Request] Target email:", cleanEmail);

    if (!process.env.BREVO_USER || !process.env.BREVO_PASS) {
      console.error("❌ [OTP Error] Missing BREVO credentials in .env");
      return res.status(500).json({ success: false, message: "Server configuration error. Brevo credentials missing." });
    }

    // 1. Generate secure 6-digit OTP instantly
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`🔑 [OTP Generated] Target: ${cleanEmail} | Code: ${generatedOtp} (To be hashed)`);

    // 2. Hash the OTP securely
    const hashedOtp = await bcrypt.hash(generatedOtp, 10);

    // 3. Invalidate previous OTP for this email in database
    await Otp.deleteMany({ email: cleanEmail });

    // 4. Store the OTP securely with 10-minute expiry timestamp in DB
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    const otpRecord = new Otp({
      email: cleanEmail,
      otp: hashedOtp,
      expiresAt: otpExpiry
    });
    await otpRecord.save();
    console.log(`📁 [Database Saved] Hashed OTP stored for ${cleanEmail}. Expiry: ${otpExpiry.toISOString()}`);

    // 5. Send OTP via WhatsApp instead of Brevo SMTP
    try {
      // Find the user's phone number
      const user = await User.findOne({ email: cleanEmail });
      
      // Get phone from request body or database
      let targetPhone = req.body.phone || (user ? user.phone : null);

      if (!targetPhone) {
        console.log(`❌ [OTP Error] No phone number found for ${cleanEmail} to send WhatsApp OTP`);
        return res.status(400).json({ success: false, message: "Phone number required for WhatsApp OTP. Please ensure your account has a phone number." });
      }

      // Format phone number to WhatsApp format (e.g., 919876543210@c.us)
      let formattedPhone = targetPhone.replace(/\D/g, '');
      if (formattedPhone.length === 10) {
        formattedPhone = "91" + formattedPhone;
      }
      
      const chatId = formattedPhone + "@c.us";
      const message = `🛠️ *FixIt Verification*\n\nYour OTP is: *${generatedOtp}*\n\nThis code is valid for 10 minutes. Do not share this with anyone.\n\nThank you for using FixIt!`;
      
      console.log(`📤 [WhatsApp] Attempting to send OTP to ${chatId}`);
      await whatsappClient.sendMessage(chatId, message);
      console.log(`✅ [WhatsApp Success] OTP successfully delivered to ${formattedPhone}`);
    } catch (waErr) {
      console.error(`❌ [WhatsApp Failure] Failed to send OTP to ${cleanEmail}:`, waErr.message || waErr);
      
      // Development fallback: Do not block local testing if WhatsApp fails.
      console.log(`\n🔑 [DEV MODE FALLBACK] Use this OTP to verify: ${generatedOtp}\n`);
      return res.json({ 
        success: true, 
        message: `[Dev Fallback] OTP generated successfully. (OTP: ${generatedOtp})`
      });
    }

    return res.json({ 
      success: true, 
      message: "OTP sent successfully to your registered WhatsApp number."
    });

  } catch (err) {
    console.error("❌ [OTP Server Error] API request failure:", err.message || err);
    return res.status(500).json({ success: false, message: err.message || "Failed to initiate OTP request" });
  }
});

// VERIFY OTP ROUTE
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email || !otp) {
      console.log("❌ [Verify Error] Missing email or OTP in request body");
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    console.log(`🔍 [Verify Request] Verifying OTP for: ${cleanEmail}`);

    // 1. Retrieve OTP record from database
    const storedRecord = await Otp.findOne({ email: cleanEmail });

    if (!storedRecord) {
      console.log(`❌ [Verify Failed] No stored OTP found for ${cleanEmail}`);
      return res.status(400).json({ success: false, message: "OTP not requested or expired" });
    }

    // 2. Expiry check
    if (new Date() > storedRecord.expiresAt) {
      await Otp.deleteOne({ _id: storedRecord._id });
      console.log(`❌ [Verify Failed] OTP has expired for ${cleanEmail}`);
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    // 3. Validation check
    const isValid = await storedRecord.compareOtp(cleanOtp);

    if (isValid) {
      // 4. Delete the OTP record immediately to prevent reuse
      await Otp.deleteOne({ _id: storedRecord._id });
      console.log(`🗑️ [OTP Deleted] Record removed to prevent reuse for ${cleanEmail}`);

      // 5. Mark email as verified in database (update otpVerified to true)
      try {
        const updateResult = await User.updateOne(
          { email: cleanEmail },
          { $set: { otpVerified: true } }
        );
        console.log(`📁 [Database Update] Marked ${cleanEmail} verified. modifiedCount: ${updateResult.modifiedCount}`);
      } catch (dbErr) {
        console.error("❌ [Database Error] Failed to update user otpVerified field:", dbErr.message);
      }

      return res.json({ success: true, message: "Email Verified Successfully" });
    }
    
    console.log(`❌ [Verify Failed] Invalid OTP entered for ${cleanEmail}`);
    return res.status(400).json({ success: false, message: "Invalid OTP. Please check the code and try again." });

  } catch (err) {
    console.error("❌ [Verify Server Error]:", err.message);
    return res.status(500).json({ success: false, message: "Server error occurred during verification" });
  }
});

export default router;