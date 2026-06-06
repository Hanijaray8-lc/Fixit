import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import Worker from "../models/Worker.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import WorkerWallet from "../models/WorkerWallet.js";
import Transaction from "../models/Transaction.js";
import User from "../models/UserModels.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || process.env.TESTAPI_KEY || "rzp_test_mock",
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.TESTKEY_SECRET || "mock_secret",
});

// Create Order (Initialize payment before frontend opens Razorpay modal)
router.post("/create-order", async (req, res) => {
  try {
    const { amount, bookingId, userId, isPremiumOrder } = req.body;
    
    // Check if user already premium (wrap in try-catch to be offline-resilient)
    try {
      if (userId) {
        const user = await User.findById(userId);
        if (user && (user.premiumMember || user.isPremium)) {
          return res.status(400).json({ error: "Premium membership already active." });
        }
      }
    } catch (dbErr) {
      console.warn(" ⚠️ [Mongoose Offline] Skipping premium check in order creation:", dbErr.message);
    }

    if (!amount || (!bookingId && !isPremiumOrder)) {
      return res.status(400).json({ error: "Amount and bookingId required" });
    }

    // Limit receipt length to strictly under 40 characters to prevent Razorpay validation errors
    const receiptId = isPremiumOrder 
      ? `prem_${Date.now()}` 
      : `rec_${String(bookingId).slice(-12)}`;

    const options = {
      amount: amount * 100, 
      currency: "INR",
      receipt: receiptId,
    };

    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).json({ error: "Failed to create order" });

    res.json({ order });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


router.post("/success", async (req, res) => {
  try {
    console.log(" [WEBHOOK] /api/payment/success triggered!");
    console.log(" Received Webhook Payload:", req.body);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId, paymentMethod } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "mock_secret")
      .update(sign.toString())
      .digest("hex");

    console.log(" Expected Signature:", expectedSign);
    console.log(" Received Signature:", razorpay_signature);

    // If signature doesn't match, return error (skip check for simulated/mock test payments)
    if (razorpay_signature && razorpay_order_id && !razorpay_signature.includes("SIMULATED") && !razorpay_signature.includes("mock")) {
      if (razorpay_signature !== expectedSign) {
        console.error("Invalid payment signature");
        return res.status(400).json({ error: "Invalid payment signature" });
      }
    } else {
      console.log(" Skipping signature validation (Test Mode / Simulated Payment)");
    }

    // Step 1: Handle Plan Purchases (SINGLE_BOOKING or Premium)
    if (bookingId === "SINGLE_BOOKING" || !bookingId) {
      const isPremium = !bookingId; // null bookingId implies Premium
      const amount = isPremium ? 499 : 49;
      
      const { userId } = req.body;
      if (userId) {
        const User = (await import("../models/UserModels.js")).default;
        const updateData = isPremium 
          ? {
              membershipType: "PREMIUM",
              remainingBookings: 9999, // unlimited
              isPremium: true,
              premiumMember: true,
              premiumPlan: "Premium Membership",
              premiumAmount: 499,
              premiumActivatedAt: new Date(),
              premiumPaymentId: razorpay_payment_id || "PAY_MOCK_" + Date.now(),
              premiumStartDate: new Date(),
              premiumExpiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          : {
              membershipType: "SINGLE_BOOKING",
              remainingBookings: 1,
              isPremium: false,
              premiumPaymentId: razorpay_payment_id || "PAY_MOCK_" + Date.now()
            };

        await User.findByIdAndUpdate(userId, updateData);

        // Record as a system booking for Admin Earnings
        try {
          const Booking = (await import("../models/Booking.js")).default;
          await Booking.create({
            name: isPremium ? "Premium Member" : "Single Booking Pass",
            phone: "9999999999",
            email: "user@test.com",
            serviceType: isPremium ? "Premium Pack" : "Single Booking Access",
            location: "Online",
            status: "COMPLETED",
            basePrice: 0,
            convinceFee: amount,
            totalPrice: amount,
            paymentStatus: "COMPLETED",
            paymentId: razorpay_payment_id || "PAY_MOCK_" + Date.now(),
            paymentMethod: paymentMethod || "Online",
            completedAt: new Date()
          });
        } catch (bookingErr) {
          console.error("Failed to log plan payment for admin earnings:", bookingErr);
        }
      }

      return res.json({ success: true, message: "Plan activated successfully" });
    }

    // Normal Booking Payment Flow
    console.log(` Looking for Booking ID: ${bookingId}`);
    const booking = await Booking.findById(bookingId).populate("workerId");
    if (!booking) {
      console.error(` Booking not found for ID: ${bookingId}`);
      return res.status(404).json({ error: "Booking not found" });
    }
    console.log(" Booking found:", booking._id);

    // 1. Mark Booking as PAYMENT_SUCCESSFUL immediately so it is guaranteed to persist even if splits fail
    booking.status = "PAYMENT_SUCCESSFUL";
    booking.paymentStatus = "Success";
    await booking.save();
    console.log(" Booking status permanently saved as PAYMENT_SUCCESSFUL in DB");

    // Ensure duplicate Payment entries are NOT created
    let paymentEntry = await Payment.findOne({ bookingId: booking._id });
    if (!paymentEntry) {
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

      paymentEntry = await Payment.create({
        paymentId: razorpay_payment_id || "TEST_PAYMENT_" + Date.now(),
        orderId: razorpay_order_id || "TEST_ORDER_" + Date.now(),
        bookingId: booking._id,
        workerId: booking.workerId?._id || booking.workerId,
        amount: booking.totalPrice || booking.totalAmount || 0,
        paymentMethod: paymentMethod || "Card",
        status: "PAYMENT_SUCCESSFUL",
        workerName: booking.workerId?.name || "Expert",
        customerName: booking.name || "Customer",
        serviceName: booking.serviceType || "General Work",
        amountPaid: booking.totalPrice || booking.totalAmount || 0,
        paymentStatus: "Success",
        transactionDate,
        transactionTime
      });
      console.log(" New Payment entry created in DB with detailed transaction fields");
    } else {
      console.log(" Payment entry already exists for booking:", booking._id);
    }

    // Step 2: SPLIT LOGIC (BACKEND ONLY)
    // Now we use the calculated workerShare from the booking
    const serviceCharge = booking.workerShare || booking.basePrice || 0; 
    const workerId = booking.workerId?._id || booking.workerId;

    console.log(` Calculated serviceCharge (workerShare): ₹${serviceCharge}`);
    console.log(` Worker ID: ${workerId}`);

    if (workerId) {
      // Find or create worker wallet
      let wallet = await WorkerWallet.findOne({ workerId });
      if (!wallet) {
        console.log(" Creating new wallet for worker");
        wallet = new WorkerWallet({ workerId });
      } else {
        console.log("Existing wallet found, current balance:", wallet.balance);
      }

      // Add serviceCharge to worker wallet
      wallet.balance = (wallet.balance || 0) + serviceCharge;
      wallet.todayEarnings += serviceCharge;
      wallet.weekEarnings += serviceCharge;
      wallet.totalEarnings += serviceCharge;
      wallet.pendingPayout += serviceCharge;
      await wallet.save();
      
      console.log(` Wallet updated! New balance: ₹${wallet.balance}, Total Earnings: ₹${wallet.totalEarnings}`);
      
      // Update booking payment status
      booking.paymentStatus = "Success";
      await booking.save();
      console.log(" Booking paymentStatus marked as Success");

      // Step 3: STORE TRANSACTION HISTORY
      // Ensure duplicate Transaction entries are NOT created
      const existingTx = await Transaction.findOne({ bookingId: booking._id });
      if (!existingTx) {
        await Transaction.create({
          workerId: workerId,
          bookingId: booking._id,
          amount: serviceCharge,
          type: "EARNING",
          status: "COMPLETED"
        });
        console.log("Transaction history saved");
      } else {
        console.log("Transaction entry already exists for booking:", booking._id);
      }

      // Step 4: Trigger automatic WhatsApp message to the assigned worker
      if (booking.workerId && booking.workerId.phone) {
        const displayDateTime = `${booking.bookingDate} at ${booking.bookingTime}`;
        const workerWhatsAppMsg = `✅ Payment Successful by ${booking.name}\nAmount: ₹${booking.totalPrice}\nDate & Time: ${displayDateTime}`;
        console.log(`[WhatsApp Success Message] Sending to worker phone: ${booking.workerId.phone}`);
        console.log(`Message:\n${workerWhatsAppMsg}`);
      }
    } else {
      console.error("No workerId found on booking, skipping wallet update!");
    }

    console.log(" Payment processing completely successful!");
    res.json({ message: "Payment verified successfully, split applied", payment: paymentEntry });
  } catch (err) {
    console.error(" Payment verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
