import nodemailer from "nodemailer";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

console.log("🔍 [Email Config] Initializing Brevo Email Service...");

// Configure SMTP transporter
export const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  },
  connectionTimeout: 8000,
  greetingTimeout: 8000
});



export const sendEmail = async ({ to, subject, text, html }) => {
  console.log("BREVO_USER:", process.env.BREVO_USER);
  console.log("BREVO_PASS EXISTS:", !!process.env.BREVO_PASS);
  const mailOptions = {
    from: '"Fixit App" <sangeetha.m17107@gmail.com>', 
    to: to,
    subject: subject,
    text: text,
    html: html
  };

  // Attempt 1: Brevo HTTP API (High Speed, Port 443)
  try {
    console.log(`📨 [Email Service] Attempting delivery via high-speed Brevo HTTP API to: ${to}`);
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Fixit App", email: "sangeetha.m17107@gmail.com" },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html || text,
        textContent: text || html
      },
      {
        headers: {
          "accept": "application/json",
          "api-key": process.env.BREVO_PASS,
          "content-type": "application/json"
        },
        timeout: 6000
      }
    );

    console.log(`✅ [Email Success] Delivered via Brevo HTTP API. Message ID: ${response.data.messageId}`);
    return response.data;
  } catch (httpError) {
    console.warn(`⚠️ [Email Warning] HTTP API delivery failed: ${httpError.message || httpError}`);
    console.log(`⚡ [Email Fallback] Swapping protocol to Brevo SMTP Relay...`);

    // Attempt 2: SMTP Relay Fallback
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ [Email Success] Delivered via Brevo SMTP. Message ID: ${info.messageId}`);
      return info;
    } catch (smtpError) {
      const detailedError = smtpError.message || smtpError;
      console.error(`❌ [Email Error] Both HTTP API and SMTP delivery attempts failed.`);
      console.error("❌ [Email Error Details]:", detailedError);
      throw new Error(`Email delivery failed: ${smtpError.message || "Unknown Brevo error"}`);
    }
  }
};
