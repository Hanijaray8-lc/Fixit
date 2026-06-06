import dotenv from "dotenv";
import qrcode from "qrcode-terminal";

dotenv.config();

import dns from "dns";
// Set Google DNS & Cloudflare DNS to resolve MongoDB Atlas SRV records reliably
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  console.log("Failed to configure custom DNS servers:", e.message);
}

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import bookingRoutes from "./routes/bookingRoutes.js";
import otpRoutes from "./routes/otpRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import workerRoutes from "./routes/workerRoutes.js";
import adminRoute from "./routes/adminRoute.js";
import diagnosisRoutes from "./routes/diagnosisRoute.js";
import jobRoutes from "./routes/jobRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import membershipRoutes from "./routes/membershipRoutes.js";
import fetchRoutes from './routes/fetchRoutes.js';
import queryRoutes from "./routes/queryRoutes.js";
import ViewProfile from "./routes/viewprofileRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { startPayoutCron, startDailyResetCron } from "./cron/payoutJob.js";
import Worker from "./models/Worker.js";
import whatsappClient from "./whatsapp.js";
import sosRoutes from "./routes/sosRoute.js";
process.on("uncaughtException", (err) => {
  console.log(" CRASH PREVENTED:", err);
});

process.on("unhandledRejection", (err) => {
  console.log(" PROMISE ERROR:", err);
});


let started = false;

const startWhatsApp = async () => {
  if (started) return;

  started = true;

  try {
    await whatsappClient.initialize();
    console.log("WhatsApp Started");
  } catch (err) {
    console.error("WhatsApp Init Failed:", err.message);
  }
};

whatsappClient.on("disconnected", (reason) => {
  console.log("❌ WhatsApp Disconnected:", reason);
});

whatsappClient.on("auth_failure", (msg) => {
  console.log("❌ WhatsApp Auth Failed:", msg);
});

whatsappClient.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Please scan the QR code above to login to WhatsApp");
});

whatsappClient.on("ready", async () => {
  console.log("✅ WhatsApp Ready!");
});

// // Helper for delaying execution
// const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// whatsappClient.on("ready", async () => {
//   console.log("WhatsApp Ready!");
  
//   try {
//     console.log("⏳ Waiting a few seconds for full sync before sending...");
//     await delay(5000); // Wait 5 seconds

//     const numberId = "918825961577@c.us";
//     const text = "FixIt Test Message ✅";

//     console.log(`🔍 Checking if ${numberId} is registered...`);
//     const isRegistered = await whatsappClient.isRegisteredUser(numberId);

//     if (!isRegistered) {
//       console.error(`❌ Error: The number ${numberId} is NOT registered on WhatsApp.`);
//       return; 
//     }

//     console.log(`📤 Sending message to ${numberId}...`);
//     const res = await whatsappClient.sendMessage(numberId, text);

//     if (res && res.id) {
//       console.log(`✅ MESSAGE SENT! (ID: ${res.id.id})`);
//     } else {
//       console.error("⚠️ Message seemed to send, but no valid response ID was returned.");
//     }
//   } catch (err) {
//     console.error("❌ Send Failed! Error details:");
//     console.error(err);
//   }
// });

// whatsappClient.on("message_ack", (msg, ack) => {
//   console.log(`📨 Message Ack Update (ID: ${msg.id.id}): ${ack}`);
// });


const app = express();

app.use(cors({
  origin: "*"
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
// Start the Express server immediately so APIs respond fast and never throw Server Errors
const PORT = process.env.PORT || 5005;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(" Windows is silently running an OLD, STALE version of your server!");
  } else {
    console.error(" Server start failed:", err.message);
  }
});

const connectWithRetry = () => {
  console.log("Connecting to MongoDB Atlas...");
  mongoose.connect(process.env.MONGO_URI, { family: 4 })
    .then(() => {
      console.log("MongoDB Connected Successfully");
      startWhatsApp();

      setInterval(async () => {
        try {
          const thresholdDate = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000); // 21 days ago
          const result = await Worker.updateMany(
            { lastActive: { $lt: thresholdDate }, isOnline: true },
            { $set: { isOnline: false } }
          );
          if (result.modifiedCount > 0) {
            console.log(`[Worker Status] Auto-marked ${result.modifiedCount} inactive workers as offline.`);
          }
        } catch (err) {
          console.error("Error updating worker status automatically:", err);
        }
      }, 60 * 60 * 1000); 

      // Start Cron Jobs
      startPayoutCron();
      startDailyResetCron();
    })
    .catch((err) => {
      console.error(" MongoDB Connection Failed:", err.message);
      console.log("Retrying MongoDB connection in 5 seconds...");
      setTimeout(connectWithRetry, 5000);
    });
};

connectWithRetry();



app.use("/api", diagnosisRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/users", userRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/admin", adminRoute);
app.use("/api", jobRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/membership", membershipRoutes);
app.use('/api/fetch', fetchRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/profile",ViewProfile);

// Payment & Wallet
app.use("/api/payment", paymentRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/chat", chatRoutes);


app.use("/api/sos", sosRoutes);
app.get("/api/queries-test", (req, res) => res.send("Query Route Active!"));

app.get("/api/settings", (req, res) => {
  res.json({
    companyName: "Life Changers Ind",
    mainBranch: "5/106A, JJ Nagar, Reddiarpatti, Tirunelveli, Tamil Nadu 627007",
    subBranch: "Makkah Mukarramah Street, Safath, Jubail - 35514",
    phones: [
      "+91 94860 42369",
      "+91 99430 42369",
      "+91 81480 42369"
    ],
    email: "lifechangersind@gmail.com"
  });
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});

// Server port handles are now initialized dynamically upon MongoDB connection in .then() above.


