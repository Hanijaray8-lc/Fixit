import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "" },              // ✅ customer email for OTP
    serviceType: { type: String, required: true },
    location: { type: String, required: true },        // ✅ changed from 'address'
    bookingDate: { type: String },
    bookingTime: { type: String },
    issueImage: { type: String, default: null }, // Live Camera Photo

    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      default: null,
      index: true,
    },

    assignedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: [
        "PENDING",
        "AWAITING_PAYMENT",
        "CONFIRMED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
        "REJECTED",
        "PRICE_PENDING",
        "Pending",
        "Assigned",
        "Accepted",
        "Rejected",
        "Completed",
        "ASSIGNED",
        "ACCEPTED",
        "REQUESTED",
        "PAYMENT_SUCCESSFUL",
        "PAYMENT_ACCEPTED",
        "COD_CONFIRMED"
      ],
      default: "PENDING",
    },

    basePrice: { type: Number, default: 300 },
    convinceFee: { type: Number, default: 50 },
    totalPrice: { type: Number, default: 350 },

    totalAmount: { type: Number, default: 0 },
    workerShare: { type: Number, default: 0 },
    platformShare: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ["PENDING", "COMPLETED", "FAILED", "PAYMENT_SUCCESSFUL", "PAYMENT_ACCEPTED", "COD_CONFIRMED", "Paid", "Success"], default: "PENDING" },

    proposedPrice: { type: Number, default: null },
    proposedWorkersRequired: { type: Number, default: 1 },
    proposedReason: { type: String, default: "" },
    proposedConvinceFee: { type: Number, default: null },
    proposedTotalPrice: { type: Number, default: null },

    notifications: {
      workerNotified: { type: Boolean, default: false },
      adminNotified: { type: Boolean, default: false },
    },

    geoLocation: {
      lat: Number,
      lng: Number,
    },
    completionOtp: {
      type: String,
      default: null,
    },
    otpVerified: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    paymentId: { type: String, default: null },
    orderId: { type: String, default: null },
    paymentMethod: { type: String, default: null },
    commissionPaid: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Booking", bookingSchema);