import express from "express";
import {
  approveWorker,
  rejectWorker,
  getAllWorkers,
  getAdminStats,
  getAllUsers,
  updateUserStatus
} from "../Controllers/adminController.js";

const router = express.Router();

// Workers
router.get("/workers", getAllWorkers);
router.put("/approve/:id", approveWorker);
router.put("/reject/:id", rejectWorker);

// Users
router.get("/users", getAllUsers);
router.put("/users/status/:id", updateUserStatus);

// Admin stats
router.get("/stats", getAdminStats);

export default router;