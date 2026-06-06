import mongoose from "mongoose";

const JobSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      default: null,
    },

    service: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      default: "Pending",
      enum: ["Pending", "Accepted", "Completed", "Rejected"],
    },
  },
  { timestamps: true }
);

// create model
const Job = mongoose.model("Job", JobSchema);

export default Job;