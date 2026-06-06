import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["EARNING", "PAYOUT"],
      required: true,
    },
    status: {
      type: String,
      enum: ["COMPLETED", "PENDING", "FAILED"],
      default: "COMPLETED",
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);
