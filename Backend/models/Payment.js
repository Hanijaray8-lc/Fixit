import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      required: true,
      unique: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "PENDING", "PAYMENT_SUCCESSFUL", "PAYMENT_ACCEPTED", "COD_CONFIRMED"],
      default: "PENDING",
    },
    workerName: { type: String, default: "" },
    customerName: { type: String, default: "" },
    serviceName: { type: String, default: "" },
    amountPaid: { type: Number, default: 0 },
    paymentStatus: { type: String, default: "Success" },
    transactionDate: { type: String, default: "" },
    transactionTime: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);
