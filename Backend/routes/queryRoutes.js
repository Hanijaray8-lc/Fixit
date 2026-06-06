import express from "express";
import Query from "../models/Query.js";

const router = express.Router();

// Submit a new query
router.post("/", async (req, res) => {
  try {
    const { userName, workerName, serviceCategory, query } = req.body;

    if (!userName || !workerName || !serviceCategory || !query) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const newQuery = new Query({
      userName,
      workerName,
      serviceCategory,
      query,
    });

    await newQuery.save();

    res.status(201).json({
      success: true,
      message: "Query raised successfully",
    });
  } catch (error) {
    console.error("Error saving query:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

// Get all queries for Admin Dashboard
router.get("/all", async (req, res) => {
  try {
    const queries = await Query.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      queries,
    });
  } catch (error) {
    console.error("Error fetching queries:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

export default router;
