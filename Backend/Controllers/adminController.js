import Worker from "../models/Worker.js";
import User from "../models/UserModels.js";
import Booking from "../models/Booking.js";

// APPROVE WORKER
export const approveWorker = async (req, res) => {
  try {
    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      {
        status: "Active",
        notification: " You are approved by admin"
      },
      { returnDocument: 'after' }
    );

    res.json({ success: true, worker });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// REJECT WORKER
export const rejectWorker = async (req, res) => {
  try {
    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      {
        status: "Rejected",
        notification: " You are rejected by admin"
      },
      { returnDocument: 'after' }
    );

    res.json({ success: true, worker });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getAllWorkers = async (req, res) => {
  const workers = await Worker.find();
  res.json({ workers });
};

export const getAdminStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalBookings,
      completedBookings,
      pendingBookings,
      activeWorkers,
      busyWorkers,
      totalWorkers,
      recentBookingsList,
      topServicesAggregate
    ] = await Promise.all([
      User.countDocuments({}),
      Booking.countDocuments({}),
      Booking.countDocuments({ status: "Completed" }),
      Booking.countDocuments({ status: "Pending" }),
      Worker.countDocuments({ status: "Active" }),
      Worker.countDocuments({ status: "Busy" }),
      Worker.countDocuments({}),
      Booking.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name serviceType location status createdAt email")
        .lean(),
      Booking.aggregate([
        { $group: { _id: "$serviceType", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    const calculatedRevenue = completedBookings * 500;
    const baseRevenue = 15000;
    const revenue = Math.max(calculatedRevenue, baseRevenue);

    res.json({
      success: true,
      stats: {
        users: totalUsers || 0,
        orders: totalBookings || 0,
        revenue: revenue,
        completedBookings,
        pendingBookings,
        activeWorkers,
        busyWorkers,
        totalWorkers
      },
      recentBookings: recentBookingsList,
      topServices: topServicesAggregate
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET ALL USERS
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select("name email serviceCategory address phone status premiumMember isPremium")
      .lean();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// UPDATE USER STATUS (ACTIVATE/DEACTIVATE)
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { returnDocument: 'after' }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


