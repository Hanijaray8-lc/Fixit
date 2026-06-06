import express from "express";
import Job from "../models/Job.js";

const router = express.Router();


router.post("/jobs", async (req, res) => {
  try {
    console.log(req.body);
    const { service, workerId, status } = req.body;

    const job = await Job.create({
      service,
      workerId: workerId || null,
      status: status || "Pending",
    });

    res.status(201).json({ job }); 
  } catch (err) {
    console.error("Job create error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/jobs/:workerId", async (req, res) => {
  try {
    const jobs = await Job.find({ workerId: req.params.workerId });

    res.status(200).json({ jobs }); 
  } catch (err) {
    console.error("Fetch jobs error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;