import cron from "node-cron";
import WorkerWallet from "../models/WorkerWallet.js";
import Transaction from "../models/Transaction.js";

// Mock Payout API function
const initiateRazorpayXPayout = async (workerId, amount) => {
  // In real scenario, make API call to RazorpayX or Cashfree
  console.log(`[MOCK PAYOUT] Initiated payout of ₹${amount} for worker ${workerId}`);
  return true; // Simulate success
};

// Weekly Payout Cron Job
// Runs every Tuesday at 10:00 AM
const startPayoutCron = () => {
  cron.schedule("0 10 * * 2", async () => {
    console.log("[CRON] Starting weekly payout job...");

    try {
      // Find workers with pending payouts
      const wallets = await WorkerWallet.find({ weekEarnings: { $gt: 0 } });

      for (const wallet of wallets) {
        const payoutAmount = wallet.weekEarnings;
        const workerId = wallet.workerId;

        // Initiate payout
        const success = await initiateRazorpayXPayout(workerId, payoutAmount);

        if (success) {
          // Reset weekly and pending
          wallet.weekEarnings = 0;
          wallet.pendingPayout = wallet.pendingPayout - payoutAmount;
          wallet.lastPayoutDate = new Date();
          await wallet.save();

          // Log transaction
          await Transaction.create({
            workerId: workerId,
            amount: payoutAmount,
            type: "PAYOUT",
            status: "COMPLETED"
          });

          console.log(`[CRON] Payout successful for worker ${workerId}`);
        }
      }
      
      console.log("[CRON] Weekly payout job completed.");
    } catch (err) {
      console.error("[CRON] Error during payout job:", err);
    }
  });
};

// We also need a cron job to reset todayEarnings every midnight
const startDailyResetCron = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      await WorkerWallet.updateMany({}, { todayEarnings: 0 });
      console.log("[CRON] Reset todayEarnings for all wallets.");
    } catch (err) {
      console.error("[CRON] Error resetting todayEarnings:", err);
    }
  });
};

export { startPayoutCron, startDailyResetCron };
