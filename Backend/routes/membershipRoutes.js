import express from "express";
import User from "../models/UserModels.js";

const router = express.Router();

// GET /api/membership/:userId
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Check expiry logic
    let currentMembershipType = user.membershipType || "FREE";
    let currentIsPremium = user.isPremium || false;

    if (user.premiumExpiryDate && new Date(user.premiumExpiryDate) > new Date()) {
      // Active premium
      currentMembershipType = "PREMIUM";
      currentIsPremium = true;
    } else if (currentMembershipType === "PREMIUM") {
      // Expired Premium
      currentMembershipType = "FREE";
      currentIsPremium = false;
      user.membershipType = "FREE";
      user.isPremium = false;
      user.premiumMember = false;
      await user.save();
    } else if (currentMembershipType !== "SINGLE_BOOKING") {
       currentMembershipType = "FREE";
       currentIsPremium = false;
    }

    return res.json({
      success: true,
      membershipType: currentMembershipType,
      isPremium: currentIsPremium,
      premiumExpiry: user.premiumExpiryDate,
      remainingBookings: user.remainingBookings || 0
    });
  } catch (error) {
    console.error("Fetch membership error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/membership/update
router.put("/update", async (req, res) => {
  try {
    const { userId, membershipType, isPremium, premiumExpiry, remainingBookings } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.membershipType = membershipType;
    user.isPremium = isPremium;
    if (premiumExpiry) {
      user.premiumExpiryDate = new Date(premiumExpiry);
    }
    if (remainingBookings !== undefined) {
      user.remainingBookings = remainingBookings;
    }

    if (membershipType === "PREMIUM") {
      user.premiumMember = true;
    }

    await user.save();

    res.json({
      success: true,
      message: "Membership updated successfully",
      membershipType: user.membershipType,
      isPremium: user.isPremium,
      premiumExpiry: user.premiumExpiryDate,
      remainingBookings: user.remainingBookings
    });
  } catch (error) {
    console.error("Update membership error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
