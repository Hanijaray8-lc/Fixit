import express from "express";
import Feedback from "../models/Feedback.js";

const router = express.Router();


// Submit feedback
router.post("/", async (req, res) => {
  try {
    const { workerEmail, workerName, customerName, rating, comment, image } = req.body;

    if (!workerEmail || !workerName || !customerName || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: "All fields required",
      });
    }

    // Standalone Duplicate Protection (10-second threshold)
    const duplicateStandalone = await Feedback.findOne({
      workerEmail: workerEmail.toLowerCase().trim(),
      customerName,
      comment,
      createdAt: { $gte: new Date(Date.now() - 10000) }
    });

    if (duplicateStandalone) {
      console.log("Blocked duplicate standalone feedback submission");
      return res.status(201).json({
        success: true,
        message: "Feedback submitted successfully (duplicate ignored)",
      });
    }

    const newFeedback = new Feedback({
      workerEmail,
      workerName,
      customerName,
      rating,
      comment,
      image: image || null,
    });

    await newFeedback.save();

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


// Get all feedbacks for admin
router.get("/all", async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      feedbacks,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


// Get feedback by worker email
router.get("/:email", async (req, res) => {
  try {
    const workerEmail = req.params.email;

    const feedbacks = await Feedback.find({
      workerEmail: workerEmail.toLowerCase(),
    });

    res.json({
      success: true,
      feedbacks,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;