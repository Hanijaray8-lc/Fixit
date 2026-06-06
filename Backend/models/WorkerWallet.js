import mongoose from "mongoose";

const workerWalletSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
      unique: true,
    },
    todayEarnings: {
      type: Number,
      default: 0,
    },
    balance: {
      type: Number,
      default: 0,
    },
    pendingBalance: {
      type: Number,
      default: 0,
    },
    weekEarnings: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    pendingPayout: {
      type: Number,
      default: 0,
    },
    lastPayoutDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("WorkerWallet", workerWalletSchema);
