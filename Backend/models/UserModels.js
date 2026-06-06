import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: { type: String, unique: true },
  password: String,
  address: String,
  status: {
    type: String,
    default: "Active"
  },
  serviceCategory: {
    type: String,
    default: "Home Cleaning"
  },
  role: {
    type: String,
    default: "user"
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  premiumMember: {
    type: Boolean,
    default: false
  },
  premiumPlan: {
    type: String,
    default: null
  },
  premiumAmount: {
    type: Number,
    default: 0
  },
  premiumStartDate: {
    type: Date,
    default: null
  },
  premiumExpiryDate: {
    type: Date,
    default: null
  },
  premiumActivatedAt: {
    type: Date,
    default: null
  },
  premiumPaymentId: {
    type: String,
    default: null
  },
  otpVerified: {
    type: Boolean,
    default: false
  },
  membershipType: {
    type: String,
    default: "NONE"
  },
  remainingBookings: {
    type: Number,
    default: 0
  },
  profileImage: {
    type: String,
    default: ""
  }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

export default User;