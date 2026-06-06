import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

// Method to compare candidate OTP with database hashed OTP
otpSchema.methods.compareOtp = async function (candidateOtp) {
  return await bcrypt.compare(candidateOtp, this.otp);
};

const Otp = mongoose.model("Otp", otpSchema);
export default Otp;
