import express from "express";
import WorkerWallet from "../models/WorkerWallet.js";
import Transaction from "../models/Transaction.js";
import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";

const router = express.Router();

const getWallet = async (workerId) => {
  let wallet = await WorkerWallet.findOne({ workerId });
  if (!wallet) {
    wallet = await WorkerWallet.create({ workerId });
  }
  return wallet;
};


router.get("/overview/:workerId", async (req, res) => {
  try {
    const wallet = await getWallet(req.params.workerId);
    res.json({
      balance: wallet.balance || 0,
      pendingBalance: wallet.pendingBalance || 0,
      totalEarnings: wallet.totalEarnings || 0,
      todayEarnings: wallet.todayEarnings || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/earnings/today/:workerId", async (req, res) => {
  try {
    const wallet = await getWallet(req.params.workerId);
    res.json({ todayEarnings: wallet.todayEarnings });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/earnings/week/:workerId", async (req, res) => {
  try {
    const wallet = await getWallet(req.params.workerId);
    res.json({ weekEarnings: wallet.weekEarnings });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/earnings/total/:workerId", async (req, res) => {
  try {
    const wallet = await getWallet(req.params.workerId);
    res.json({ totalEarnings: wallet.totalEarnings });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/payout/status/:workerId", async (req, res) => {
  try {
    const wallet = await getWallet(req.params.workerId);
    
    
    const today = new Date();
    const nextTuesday = new Date();
    nextTuesday.setDate(today.getDate() + ((2 + 7 - today.getDay()) % 7 || 7));
    nextTuesday.setHours(0, 0, 0, 0);

    res.json({
      pendingPayout: wallet.pendingPayout,
      nextPayoutDate: nextTuesday,
      lastPayoutDate: wallet.lastPayoutDate,
      status: wallet.pendingPayout > 0 ? "Scheduled" : "No pending payout"
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/jobs/history/:workerId", async (req, res) => {
  try {
    const transactions = await Transaction.find({ workerId: req.params.workerId })
      .populate("bookingId", "serviceType _id") // getting service name and id
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

const syncWorkerEarningsAndWallet = async (workerId) => {
  try {
    const Worker = (await import("../models/Worker.js")).default;
    const worker = await Worker.findById(workerId);
    const workerName = worker?.name || "Expert";

    // 1. Find all bookings that are marked successful or completed
    const bookings = await Booking.find({
      workerId,
      status: { $in: ["PAYMENT_SUCCESSFUL", "COMPLETED", "Completed", "COD_CONFIRMED"] }
    });

    for (const booking of bookings) {
      const targetAmount = booking.proposedTotalPrice || booking.totalPrice || booking.totalAmount || 350;
      const targetWorkerShare = booking.workerShare || booking.basePrice || (targetAmount - (booking.convinceFee || 50));

      let payment = await Payment.findOne({ bookingId: booking._id });

      if (!payment) {
        // Create the missing payment entry!
        const currentDate = new Date(booking.completedAt || booking.updatedAt || Date.now());
        const transactionDate = currentDate.toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric"
        });
        const transactionTime = currentDate.toLocaleTimeString("en-US", {
          hour: "2-digit", minute: "2-digit"
        });

        payment = await Payment.create({
          paymentId: "PAY_SYNC_" + booking._id + "_" + Date.now(),
          orderId: "ORDER_SYNC_" + booking._id,
          bookingId: booking._id,
          workerId: workerId,
          amount: targetAmount,
          paymentMethod: booking.paymentMethod || "Online",
          status: booking.status === "COD_CONFIRMED" ? "COD_CONFIRMED" : "PAYMENT_SUCCESSFUL",
          workerName,
          customerName: booking.name || "Customer",
          serviceName: booking.serviceType || "General Work",
          amountPaid: targetAmount,
          paymentStatus: "Success",
          transactionDate,
          transactionTime,
          createdAt: booking.completedAt || booking.updatedAt || Date.now()
        });
        console.log(`[EARNINGS SYNC] Created missing payment entry for booking ${booking._id}`);
      } else if (payment.amount !== targetAmount || payment.amountPaid !== targetAmount) {
        // Update the payment entry to correct amount!
        payment.amount = targetAmount;
        payment.amountPaid = targetAmount;
        if (payment.status !== "PAYMENT_SUCCESSFUL" && payment.status !== "COD_CONFIRMED") {
          payment.status = booking.status === "COD_CONFIRMED" ? "COD_CONFIRMED" : "PAYMENT_SUCCESSFUL";
        }
        await payment.save();
        console.log(`[EARNINGS SYNC] Fixed mismatched payment entry for booking ${booking._id}: amount updated to ₹${targetAmount}`);
      }

      // Check transaction to make sure ledger is in sync
      let tx = await Transaction.findOne({ bookingId: booking._id, type: "EARNING" });
      let wallet = await WorkerWallet.findOne({ workerId });
      if (!wallet) {
        wallet = await WorkerWallet.create({ workerId });
      }

      if (!tx) {
        // Create transaction and credit wallet
        await Transaction.create({
          workerId,
          bookingId: booking._id,
          amount: targetWorkerShare,
          type: "EARNING",
          status: "COMPLETED",
          createdAt: booking.completedAt || booking.updatedAt || Date.now()
        });
        wallet.balance = (wallet.balance || 0) + targetWorkerShare;
        wallet.todayEarnings += targetWorkerShare;
        wallet.weekEarnings += targetWorkerShare;
        wallet.totalEarnings += targetWorkerShare;
        wallet.pendingPayout += targetWorkerShare;
        await wallet.save();
        console.log(`[EARNINGS SYNC] Created missing transaction and credited worker wallet ₹${targetWorkerShare}`);
      } else if (tx.amount !== targetWorkerShare) {
        // Update transaction and adjust wallet balance difference
        const diff = targetWorkerShare - tx.amount;
        tx.amount = targetWorkerShare;
        await tx.save();

        wallet.balance = (wallet.balance || 0) + diff;
        wallet.todayEarnings += diff;
        wallet.weekEarnings += diff;
        wallet.totalEarnings += diff;
        wallet.pendingPayout += diff;
        await wallet.save();
        console.log(`[EARNINGS SYNC] Adjusted transaction and worker wallet for booking ${booking._id}: difference was ₹${diff}`);
      }
    }
  } catch (err) {
    console.error("[EARNINGS SYNC] Error running synchronization:", err);
  }
};

router.get("/earnings/:workerId", async (req, res) => {
  try {
    const workerId = req.params.workerId;

    // Run self-healing earnings synchronization before fetching payments
    await syncWorkerEarningsAndWallet(workerId);

    // 1. Fetch all successful and accepted payment entries (including COD) sorted latest first
    const payments = await Payment.find({
      workerId,
      status: { $in: ["SUCCESS", "PAYMENT_SUCCESSFUL", "PAYMENT_ACCEPTED", "COD_CONFIRMED"] }
    })
    .populate({
      path: "bookingId",
      select: "name serviceType _id bookingDate bookingTime totalPrice status basePrice convinceFee workerShare platformShare"
    })
    .sort({ createdAt: -1 });

    // 2. Fetch completed bookings count directly from DB
    const completedBookingsCount = await Booking.countDocuments({
      workerId,
      status: { $in: ["COMPLETED", "Completed", "PAYMENT_SUCCESSFUL", "COD_CONFIRMED"] }
    });

    // 3. Sum up total successful payments
    const totalEarnings = payments.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    res.json({
      success: true,
      payments,
      totalEarnings,
      completedBookingsCount
    });
  } catch (err) {
    console.error("Error in GET /api/wallet/earnings:", err);
    res.status(500).json({ success: false, error: "Server error fetching earnings" });
  }
});

router.post("/withdraw", async (req, res) => {
  const { workerId, amount } = req.body;
  try {
    if (!workerId || !amount) {
      return res.status(400).json({ success: false, message: "Missing workerId or amount" });
    }

    const wallet = await getWallet(workerId);
    if (wallet.balance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance for withdrawal" });
    }

    // Deduct from balance
    wallet.balance -= amount;
    await wallet.save();

    // Create a transaction record to log this payout settlement!
    await Transaction.create({
      workerId,
      amount,
      type: "PAYOUT",
      status: "COMPLETED",
      date: Date.now()
    });

    res.json({
      success: true,
      message: "Withdrawal processed successfully",
      balance: wallet.balance
    });
  } catch (err) {
    console.error("Withdrawal error:", err);
    res.status(500).json({ success: false, error: "Server error during withdrawal" });
  }
});

router.get("/sync-check/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;
    const clientCount = parseInt(req.query.count) || 0;

    // Run self-healing earnings synchronization before sync checks
    await syncWorkerEarningsAndWallet(workerId);

    // 1. Get current count of successful/accepted payments
    const currentCount = await Payment.countDocuments({
      workerId,
      status: { $in: ["SUCCESS", "PAYMENT_SUCCESSFUL", "PAYMENT_ACCEPTED", "COD_CONFIRMED"] }
    });

    // 2. Fetch fresh wallet details
    const wallet = await getWallet(workerId);

    // 3. Count completed bookings directly
    const completedBookingsCount = await Booking.countDocuments({
      workerId,
      status: { $in: ["COMPLETED", "Completed", "PAYMENT_SUCCESSFUL", "COD_CONFIRMED"] }
    });

    // 4. If count has increased, fetch only the new payments (optimistic limit)
    let newPayments = [];
    if (currentCount > clientCount) {
      const limitVal = currentCount - clientCount;
      newPayments = await Payment.find({
        workerId,
        status: { $in: ["SUCCESS", "PAYMENT_SUCCESSFUL", "PAYMENT_ACCEPTED", "COD_CONFIRMED"] }
      })
      .populate({
        path: "bookingId",
        select: "name serviceType _id bookingDate bookingTime totalPrice status basePrice convinceFee workerShare platformShare"
      })
      .sort({ createdAt: -1 })
      .limit(limitVal);
    }

    res.json({
      success: true,
      hasUpdates: currentCount > clientCount,
      currentCount,
      wallet: {
        balance: wallet.balance || 0,
        pendingBalance: wallet.pendingBalance || 0,
        totalEarnings: wallet.totalEarnings || 0,
        todayEarnings: wallet.todayEarnings || 0,
      },
      completedBookingsCount,
      newPayments
    });
  } catch (err) {
    console.error("Sync check error:", err);
    res.status(500).json({ success: false, error: "Server error during sync check" });
  }
});

export default router;
