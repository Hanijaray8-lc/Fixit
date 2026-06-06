import mongoose from "mongoose";

const querySchema = new mongoose.Schema(
  {
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    workerName: {
      type: String,
      required: true,
      trim: true,
    },
    serviceCategory: {
      type: String,
      required: true,
      trim: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Query", querySchema);
