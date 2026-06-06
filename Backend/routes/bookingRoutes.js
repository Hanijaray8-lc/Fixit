import express from "express";
import Booking from "../models/Booking.js";
import Worker from "../models/Worker.js";
import mongoose from "mongoose";
import axios from "axios";
import User from "../models/UserModels.js";
import { transporter, sendEmail } from "./otpRoutes.js";
import Payment from "../models/Payment.js";
import WorkerWallet from "../models/WorkerWallet.js";
import Transaction from "../models/Transaction.js";
import { verifyToken } from "../utils/verifyToken.js";
import whatsappClient from "../whatsapp.js";

const router = express.Router();

const attachPremiumStatusToBookings = async (bookings) => {
  if (!bookings || bookings.length === 0) return bookings;
  
  // Get all unique booking emails and normalize them
  const emails = bookings.map(b => b.email).filter(Boolean).map(e => e.toLowerCase().trim());
  const uniqueEmails = [...new Set(emails)];
  
  // Find all premium users with these emails
  const premiumUsers = await User.find({
    email: { $in: uniqueEmails },
    $or: [{ premiumMember: true }, { isPremium: true }]
  }).select("email");
  
  const premiumEmails = new Set(premiumUsers.map(u => u.email.toLowerCase().trim()));
  
  return bookings.map(b => {
    const bookingObj = b.toObject ? b.toObject() : b;
    const isPremiumUser = b.email ? premiumEmails.has(b.email.toLowerCase().trim()) : false;
    return { ...bookingObj, isPremiumUser };
  });
};

// Find an available worker (if no specific workerId is given)
const findWorker = async (serviceType) => {
  const workers = await Worker.find({
    service: serviceType,
    status: { $regex: /^(approved|active)$/i },
  });
  if (!workers.length) return null;
  return workers[0]; // simple: first available
};

// Optional WhatsApp (placeholder — replace with real WhatsApp Business API when available)
const sendWhatsApp = async (phone, message) => {
  try {
    console.log("[WhatsApp Placeholder] Would send to:", phone, "->", message);
    // NOTE: api.whatsapp.com/send is a browser URL, NOT a server API.
    // To send real WhatsApp messages from backend, use:
    //   - Twilio WhatsApp API
    //   - Meta WhatsApp Business Cloud API
    // For now this is a no-op placeholder.
  } catch (err) {
    console.log("WhatsApp error:", err.message);
  }
};

// CREATE BOOKING (supports manual workerId or auto-assign)
router.post("/create", async (req, res) => {
  try {
    const { name, phone, email, serviceType, location, workerId, bookingDate, bookingTime, issueImage } = req.body;

    if (!name || !phone || !serviceType || !location || !bookingDate || !bookingTime) {
      return res.status(400).json({
        success: false,
        message: "All fields required including Date and Time",
      });
    }

    let worker = null;
    if (workerId && mongoose.Types.ObjectId.isValid(workerId)) {
      worker = await Worker.findById(workerId);
      if (!worker || !["approved", "active"].includes(worker.status?.toLowerCase())) {
        worker = null;
      }
    }
    if (!worker) {
      worker = await findWorker(serviceType);
    }

    console.group("📥 [Backend] Received Booking Request");
    console.log("Location String:", location);
    console.log("Customer Email:", email || "(not provided)");
    if (req.body.geoLocation) {
      console.log("GeoCoordinates Received:", req.body.geoLocation);
    } else {
      console.log("No GeoCoordinates attached in payload.");
    }
    console.log("issueImage length:", req.body.issueImage ? req.body.issueImage.length : 0);
    console.groupEnd();

    const booking = new Booking({
      name,
      phone,
      email: email || "",   // ✅ store customer's registered email
      serviceType,
      location,
      bookingDate,
      bookingTime,
      issueImage: issueImage || null,
      workerId: worker ? worker._id : null,
      status: "PENDING",
      assignedAt: worker ? new Date() : null,
      geoLocation: req.body.geoLocation || undefined,
      basePrice: 300,
      convinceFee: 50,
      totalPrice: 350,
      paymentId: req.body.paymentId || null,
      orderId: req.body.orderId || null,
      paymentMethod: req.body.paymentMethod || null,
      commissionPaid: req.body.commissionPaid || 0,
      otpVerified: true,
    });

    await booking.save();

    // Decrement Single Booking Pass if applicable
    try {
      const User = (await import("../models/UserModels.js")).default;
      const user = await User.findOne({ $or: [{ phone }, { email }] });
      if (user && user.membershipType === "SINGLE_BOOKING" && user.remainingBookings > 0) {
        user.remainingBookings -= 1;
        // If they have no remaining bookings left, they no longer have single booking access
        if (user.remainingBookings === 0) {
           user.membershipType = "NONE";
        }
        await user.save();
      }
    } catch (err) {
      console.error("Error decrementing booking pass:", err);
    }

    if (worker) {
      await sendWhatsApp(
        worker.phone,
        `New Job Assigned: ${serviceType} on ${bookingDate} at ${bookingTime} at ${location}`
      );
    }

    res.json({
      success: true,
      booking,
      message: worker
        ? "Worker assigned automatically"
        : "No worker available, pending admin action",
    });
  } catch (err) {
    console.log("BOOKING ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET RECENT BOOKINGS FOR A USER (by name or phone)
router.get("/user", async (req, res) => {
  try {
    const { name, phone } = req.query;
    if (!name && !phone) {
      return res.status(400).json({ success: false, message: "Name or phone query parameter required" });
    }

    const conditions = [];
    if (phone && phone.trim()) {
      const pVal = phone.trim();
      conditions.push({ phone: pVal });
      const pClean = pVal.replace(/^\+91/, "");
      if (pClean !== pVal) {
        conditions.push({ phone: pClean });
      } else {
        conditions.push({ phone: `+91${pVal}` });
      }
    }
    if (name && name.trim()) {
      const nVal = name.trim();
      conditions.push({ name: nVal });
      conditions.push({ name: { $regex: new RegExp("^" + nVal + "$", "i") } });
    }

    const query = conditions.length > 0 ? { $or: conditions } : {};

    // Find bookings, populate worker, limit to recent ones
    const bookings = await Booking.find(query)
      .sort({ createdAt: -1 })
      .populate("workerId")
      .lean();

    // Map unique assigned workers
    const uniqueWorkersMap = new Map();
    bookings.forEach(b => {
      if (b.workerId && !uniqueWorkersMap.has(String(b.workerId._id))) {
        uniqueWorkersMap.set(String(b.workerId._id), {
          _id: b.workerId._id,
          name: b.workerId.name,
          phone: b.workerId.phone,
          service: b.workerId.service || b.serviceType,
          profileImage: b.workerId.profileImage || "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          location: b.workerId.location,
          isOnline: b.workerId.isOnline,
          rating: b.workerId.rating || 0
        });
      }
    });

    const recentWorkers = Array.from(uniqueWorkersMap.values()).slice(0, 7);

    res.json({
      success: true,
      recentWorkers
    });
  } catch (err) {
    console.error("Error fetching user's recent bookings:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET ALL BOOKINGS
router.get("/", async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 }).populate("workerId", "name rating phone service");
    const bookingsWithPremium = await attachPremiumStatusToBookings(bookings);
    res.json({ success: true, bookings: bookingsWithPremium });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// GET BOOKINGS FOR A SPECIFIC WORKER (status = Assigned)
router.get("/worker/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(workerId)) {
      return res.status(400).json({ success: false, message: "Invalid workerId" });
    }
    const requests = await Booking.find({ workerId }).sort({ createdAt: -1 });
    const requestsWithPremium = await attachPremiumStatusToBookings(requests);
    res.json({ success: true, requests: requestsWithPremium });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ACCEPT BOOKING (called by worker for REQUESTED booking)
router.put("/accept/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("workerId");
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    
    booking.status = "AWAITING_PAYMENT";
    await booking.save();
    
    console.log(`✅ Booking ${booking._id} accepted by worker. Status is now AWAITING_PAYMENT.`);
    
    // Send WhatsApp confirmation to user with price details
    const workerName = booking.workerId ? booking.workerId.name : "Your assigned worker";
    const msg = `Hi ${booking.name}, your booking for ${booking.serviceType} has been accepted by worker ${workerName} at a total price of ₹${booking.totalPrice} (Base: ₹${booking.basePrice} + Conv Fee: ₹${booking.convinceFee}). Please complete your payment to confirm the booking!`;
    await sendWhatsApp(booking.phone, msg);
    
    res.json({ success: true, booking, message: "Booking accepted successfully" });
  } catch (err) {
    console.error("Accept booking error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// REJECT BOOKING
router.put("/reject/:id", async (req, res) => {
  try {
    await Booking.findByIdAndUpdate(req.params.id, { status: "Rejected" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// COMPLETE BOOKING
router.put("/complete/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    
    booking.status = "Completed";
    booking.totalAmount = booking.totalPrice;
    booking.workerShare = booking.basePrice;
    booking.platformShare = booking.convinceFee;
    await booking.save();
    
    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1. SEND COMPLETION OTP
router.post("/send-completion-otp/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    // Check if status is IN_PROGRESS
    if (String(booking.status).toUpperCase() !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        message: "Completion OTP can only be requested for active/in-progress services. Current status: " + booking.status
      });
    }

    // ✅ Priority 1: Use the email stored in the booking itself (set at booking time)
    let email = booking.email || "";

    // ✅ Priority 2: Fallback — look up user by phone (exact + normalized)
    if (!email) {
      const phoneRaw  = (booking.phone || "").replace(/\s+/g, "").replace(/^\+91/, "");
      const phoneVariants = [
        phoneRaw,
        `+91${phoneRaw}`,
        `91${phoneRaw}`,
        booking.phone,
      ].filter(Boolean);

      let customer = await User.findOne({ phone: { $in: phoneVariants } });
      if (!customer) {
        customer = await User.findOne({
          name: { $regex: new RegExp("^" + booking.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") },
        });
      }
      email = customer?.email || "";
    }

    if (!email) {
      return res.status(404).json({
        success: false,
        message: "Customer email not found. Please ensure the customer registered with a valid email.",
      });
    }

    console.log("➡️ SENDING COMPLETION OTP TO:", email);

    // Generate 6-digit OTP
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP to booking
    booking.completionOtp = generatedOtp;
    booking.otpVerified = false;
    await booking.save();

    // Send OTP via WhatsApp
    let targetPhone = booking.phone;
    if (!targetPhone) {
      return res.status(404).json({
        success: false,
        message: "Customer phone number not found. Please ensure the customer registered with a valid phone number.",
      });
    }

    let cleanPhone = targetPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
    const chatId = `${cleanPhone}@c.us`;

    const waMessage = `*FixIt Service Completion*\n\nHi *${booking.name}*,\n\nYour service provider is ready to mark your *${booking.serviceType}* booking as completed.\n\nPlease share the following OTP verification code with your service worker ONLY if the work has been completed to your satisfaction:\n\n*${generatedOtp}*\n\n⚠️ Do not share this OTP if the service is incomplete or unsatisfactory.`;

    try {
      await whatsappClient.sendMessage(chatId, waMessage);
      console.log(`✅ Completion OTP successfully sent via WhatsApp to customer ${booking.name} (${cleanPhone})`);
    } catch (waErr) {
      console.error("WhatsApp sending failed for completion OTP:", waErr.message || waErr);
      console.log(`\n🔑 [DEV MODE FALLBACK] Use this Completion OTP to verify: ${generatedOtp}\n`);
      return res.json({ 
        success: true, 
        message: `[Dev Fallback] OTP generated but WhatsApp failed. (OTP: ${generatedOtp})`,
        phone: targetPhone
      });
    }

    return res.json({ 
      success: true, 
      message: "Completion OTP successfully sent to customer's WhatsApp",
      phone: targetPhone
    });

  } catch (err) {
    console.error("Completion OTP Send Error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to send completion OTP" });
  }
});

// 2. VERIFY COMPLETION OTP AND COMPLETE BOOKING
router.post("/verify-completion-otp/:id", async (req, res) => {
  const { otp } = req.body;
  try {
    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP is required" });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    // Check if status is IN_PROGRESS
    if (String(booking.status).toUpperCase() !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        message: "Completion OTP can only be verified for active/in-progress services. Current status: " + booking.status
      });
    }

    if (!booking.completionOtp) {
      return res.status(400).json({ success: false, message: "Completion OTP was not requested or has expired" });
    }

    if (booking.completionOtp !== otp.trim()) {
      return res.status(400).json({ success: false, message: "Invalid OTP. Verification failed." });
    }

    // Success! Update status, verification states and clear OTP
    booking.status = "COMPLETED";
    booking.otpVerified = true;
    booking.completedAt = new Date();
    booking.completionOtp = null;
    
    // Step 3: Job Completed (ONLY calculate shares)
    booking.totalAmount = booking.totalPrice;
    booking.workerShare = booking.basePrice;
    booking.platformShare = booking.convinceFee;
    
    await booking.save();

    console.log(`✅ Booking ${booking._id} marked as COMPLETED after successful OTP verification. Shares calculated.`);

    // Send WhatsApp confirmation to the customer
    const customerWhatsAppMsg = `Hi ${booking.name}, your booking request for ${booking.serviceType} has been completed successfully! - FIXIT`;
    await sendWhatsApp(booking.phone, customerWhatsAppMsg);

    return res.json({ 
      success: true, 
      message: "OTP Verified! Booking request successful", 
      booking 
    });

  } catch (err) {
    console.error("Completion OTP Verify Error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to verify completion OTP" });
  }
});

// GET USER'S ACTIVE BOOKINGS (for pricing review)
router.get("/user-bookings", async (req, res) => {
  try {
    const { phone, email } = req.query;
    if (!phone && !email) {
      return res.status(400).json({ success: false, message: "Phone or email query parameter required" });
    }

    const conditions = [];
    if (phone && phone.trim()) {
      const pVal = phone.trim();
      conditions.push({ phone: pVal });
      const pClean = pVal.replace(/^\+91/, "");
      if (pClean !== pVal) {
        conditions.push({ phone: pClean });
      } else {
        conditions.push({ phone: `+91${pVal}` });
      }
    }
    if (email && email.trim()) {
      conditions.push({ email: email.trim() });
    }

    if (conditions.length === 0) {
      return res.json({ success: true, bookings: [] });
    }

    const bookings = await Booking.find({ $or: conditions })
      .sort({ createdAt: -1 })
      .populate("workerId", "name rating phone service");

    const bookingsWithPremium = await attachPremiumStatusToBookings(bookings);
    res.json({ success: true, bookings: bookingsWithPremium });
  } catch (err) {
    console.error("Error fetching user active bookings:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// WORKER SENDS COUNTER PRICE
router.put("/counter-price/:id", async (req, res) => {
  try {
    const { serviceChargePerWorker, serviceCharge, workersRequired, convenienceFee, convinceFee, totalAmount, reason } = req.body;
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const chargeNum = Number(serviceChargePerWorker) || Number(serviceCharge) || 300;
    const workers = Number(workersRequired) || 1;
    let feeNum = Number(convenienceFee);
    if (isNaN(feeNum) || convenienceFee === undefined) feeNum = Number(convinceFee);
    if (isNaN(feeNum) || convinceFee === undefined) feeNum = 50;
    const totalNum = Number(totalAmount) || (chargeNum * workers + feeNum);

    booking.proposedPrice = chargeNum;
    booking.proposedWorkersRequired = workers;
    booking.proposedReason = reason || "";
    booking.proposedConvinceFee = feeNum;
    booking.proposedTotalPrice = totalNum;
    booking.status = "PRICE_PENDING";

    await booking.save();

    console.log(`💰 Worker counter proposed: ₹${totalNum} for booking ${booking._id}`);

    // Send Email Notification to Customer
    if (booking.email) {
      try {
        const mailOptions = {
          to: booking.email,
          subject: "Action Required: Worker Proposed a Price for Your Booking",
          html: `
            <div style="font-family: sans-serif; max-w: 500px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
              <h2 style="color: #0f766e; text-align: center;">Price Proposal Received</h2>
              <p>Hi <b>${booking.name || "Customer"}</b>,</p>
              <p>The worker has proposed a price for your <b>${booking.serviceType || "service"}</b> booking.</p>
              
              <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><b>Service Charge Per Worker:</b> ₹${chargeNum}</p>
                <p style="margin: 5px 0;"><b>Number of Workers:</b> ${workers}</p>
                <p style="margin: 5px 0;"><b>Convenience Fee:</b> ₹${feeNum}</p>
                ${reason ? `<p style="margin: 5px 0;"><b>Reason:</b> ${reason}</p>` : ""}
                <hr style="border: 0; border-top: 1px solid #cbd5e1; margin: 10px 0;" />
                <p style="margin: 5px 0; font-size: 18px; color: #0f766e;"><b>Total Proposed: ₹${totalNum}</b></p>
              </div>
              
              <p>Please log in to your FixIt account to Accept or Reject this proposal.</p>
              <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 30px;">This is an automated message from FixIt App.</p>
            </div>
          `
        };
        // Run asynchronously without blocking the response
        sendEmail({
          to: booking.email,
          subject: mailOptions.subject,
          html: mailOptions.html
        }).catch(err => console.error("Counter proposal email failed:", err));
      } catch (e) {
        console.error("Failed to prepare email:", e);
      }
    }

    res.json({ 
      success: true, 
      message: "Counter price submitted successfully! Awaiting user decision.",
      booking 
    });
  } catch (err) {
    console.error("Counter price error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// USER DECISION (ACCEPT or REJECT COUNTER OFFER)
router.put("/user-decision/:id", async (req, res) => {
  try {
    const { action, paymentMethod } = req.body; // "accept" or "reject"
    const booking = await Booking.findById(req.params.id).populate("workerId");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    if (action === "accept") {
      if (booking.proposedPrice !== null) {
        booking.basePrice = booking.proposedPrice;
        booking.convinceFee = booking.proposedConvinceFee;
        booking.totalPrice = booking.proposedTotalPrice;
      }
      
      const isCod = paymentMethod === "Cash on Delivery";
      if (isCod) {
        booking.status = "COD_CONFIRMED";
        booking.paymentStatus = "PAYMENT_ACCEPTED";
      } else {
        booking.status = "AWAITING_PAYMENT";
        booking.paymentStatus = "PENDING";
      }
      await booking.save();

      console.log(`✅ Booking ${booking._id} ACCEPTED by user. Status set to ${booking.status}`);

      const workerName = booking.workerId ? booking.workerId.name : "Your assigned worker";
      
      let userMsg = "";
      if (isCod) {
        userMsg = `Hi ${booking.name}, your booking for ${booking.serviceType} has been accepted and CONFIRMED at ₹${booking.totalPrice} (Cash on Delivery). Worker ${workerName} will arrive soon!`;
      } else {
        userMsg = `Hi ${booking.name}, your booking for ${booking.serviceType} has been accepted at ₹${booking.totalPrice}. Please complete the payment to confirm the booking!`;
      }
      await sendWhatsApp(booking.phone, userMsg);

      if (isCod && booking.workerId) {
        try {
          // 1. Ensure duplicate Payment entries are NOT created
          const existingPayment = await Payment.findOne({ bookingId: booking._id });
          if (!existingPayment) {
            const currentDate = new Date();
            const transactionDate = currentDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric"
            });
            const transactionTime = currentDate.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit"
            });

            await Payment.create({
              paymentId: "COD_SIMULATED_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
              orderId: "COD_ORDER_" + Date.now(),
              bookingId: booking._id,
              workerId: booking.workerId._id,
              amount: booking.totalPrice,
              paymentMethod: "Cash on Delivery",
              status: "COD_CONFIRMED",
              workerName: booking.workerId?.name || "Expert",
              customerName: booking.name || "Customer",
              serviceName: booking.serviceType || "General Work",
              amountPaid: booking.totalPrice,
              paymentStatus: "Success",
              transactionDate,
              transactionTime
            });

            // 2. Link entries to correct worker & update wallet
            const serviceCharge = booking.workerShare || booking.basePrice || 0;
            let wallet = await WorkerWallet.findOne({ workerId: booking.workerId._id });
            if (!wallet) {
              wallet = new WorkerWallet({ workerId: booking.workerId._id });
            }
            wallet.balance = (wallet.balance || 0) + serviceCharge;
            wallet.todayEarnings += serviceCharge;
            wallet.weekEarnings += serviceCharge;
            wallet.totalEarnings += serviceCharge;
            wallet.pendingPayout += serviceCharge;
            await wallet.save();

            // 3. Store in Transaction history
            await Transaction.create({
              workerId: booking.workerId._id,
              bookingId: booking._id,
              amount: serviceCharge,
              type: "EARNING",
              status: "COMPLETED"
            });
            console.log("✅ COD payment wallet update and transaction completed successfully.");
          }

          // 4. Send exact WhatsApp notification to the assigned worker automatically
          const workerWhatsAppMsg = `✅ Booking Confirmed (Cash on Delivery)\n\nCustomer selected Cash on Delivery.\n\nPlease proceed with the booking.`;
          await sendWhatsApp(booking.workerId.phone, workerWhatsAppMsg);
          console.log(`✅ Automatic COD WhatsApp sent to worker ${booking.workerId.name}`);
        } catch (walletErr) {
          console.error("Error crediting worker wallet for COD:", walletErr);
        }
      } else if (booking.workerId) {
        await sendWhatsApp(
          booking.workerId.phone,
          `Booking Accepted: Customer ${booking.name} accepted your counter offer at ₹${booking.totalPrice}. Status: ${booking.status}. Booking schedule: ${booking.bookingDate} at ${booking.bookingTime}.`
        );
      }

      return res.json({ 
        success: true, 
        message: isCod 
          ? `Booking confirmed under Cash on Delivery! Worker ${workerName} will arrive soon.`
          : `Booking accepted! Please proceed to complete the payment.`,
        booking 
      });

    } else if (action === "reject") {
      booking.status = "CANCELLED";
      await booking.save();

      console.log(`❌ Booking ${booking._id} CANCELLED by user`);

      return res.json({ 
        success: true, 
        message: "Booking request rejected and closed.",
        booking 
      });
    } else {
      return res.status(400).json({ success: false, message: "Invalid action. Use 'accept' or 'reject'" });
    }

  } catch (err) {
    console.error("User decision error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// START WORK (called by worker to move from ACCEPTED to IN_PROGRESS)
router.put("/start-work/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    
    // Check if status is CONFIRMED, ACCEPTED, PAYMENT_SUCCESSFUL, or COD_CONFIRMED
    const currentStatus = String(booking.status).toUpperCase();
    if (
      currentStatus !== "CONFIRMED" && 
      currentStatus !== "ACCEPTED" && 
      currentStatus !== "PAYMENT_SUCCESSFUL" && 
      currentStatus !== "COD_CONFIRMED"
    ) {
      return res.status(400).json({
        success: false,
        message: "Work can only be started for confirmed or accepted bookings. Current status: " + booking.status
      });
    }
    
    booking.status = "IN_PROGRESS";
    await booking.save();
    
    console.log(`🛠️ Booking ${booking._id} status is now IN_PROGRESS.`);
    
    res.json({ success: true, booking, message: "Work started!" });
  } catch (err) {
    console.error("Start work error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET ALL BOOKINGS FOR LOGGED-IN USER (SECURED)
router.get("/user/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (req.user.id !== userId) {
      return res.status(403).json({ success: false, message: "Unauthorized access" });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    const conditions = [];
    if (user.phone) {
      const pVal = user.phone.trim();
      conditions.push({ phone: pVal });
      const pClean = pVal.replace(/^\+91/, "");
      if (pClean !== pVal) {
        conditions.push({ phone: pClean });
      } else {
        conditions.push({ phone: `+91${pVal}` });
      }
    }
    if (user.email) {
      conditions.push({ email: user.email.trim() });
    }
    
    if (conditions.length === 0) {
      return res.json({ success: true, bookings: [] });
    }
    
    const bookings = await Booking.find({ $or: conditions })
      .sort({ createdAt: -1 })
      .populate("workerId", "name email phone profileImage service location isOnline rating experience");
      
    res.json({ success: true, bookings });
  } catch (err) {
    console.error("Error fetching protected user bookings:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;