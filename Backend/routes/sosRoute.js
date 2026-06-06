import express from "express";
import Worker from "../models/Worker.js";
import Booking from "../models/Booking.js";

const router = express.Router();

const SERVICE_SYNONYMS = {
  "electrical":        ["Electrical Repair", "Electrician", "electrical", "Electrical"],
  "electrical repair": ["Electrical Repair", "Electrician", "electrical", "Electrical"],
  "plumbing":          ["Plumbing", "Plumber", "plumbing"],
  "ac repair":         ["AC Repair", "AC Service", "ac", "AC"],
  "ac service":        ["AC Repair", "AC Service", "ac", "AC"],
  "home cleaning":     ["Home Cleaning", "homeclean", "cleaning", "Cleaning"],
  "carpentry":         ["Carpentry", "Carpenter", "carpentrywork"],
  "pest control":      ["Pest Control", "pestcontrol", "Pest Control"],
};

function resolveServiceTerms(issue) {
  const key = (issue || "").toLowerCase().trim();
  return SERVICE_SYNONYMS[key] ?? [issue];
}


function extractCity(address) {
  if (!address) return "";
  const addrLower = address.toLowerCase();

  const knownCities = [
    "madurai", "chennai", "coimbatore", "sattur", "trichy", "salem",
    "tirunelveli", "palayamkottai", "kovilpatti", "sivakasi",
    "virudhunagar", "thoothukudi", "dindigul", "erode", "vellore",
    "thanjavur", "nagercoil", "rajapalayam", "tenkasi", "karur"
  ];

  for (const city of knownCities) {
    if (addrLower.includes(city)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }

  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  if (parts.length === 1) return parts[0];
  return address.trim();
}

router.post("/create", async (req, res) => {
  const { userName, userPhone, userCity, issue, userAddress } = req.body;

  if (!userName || !userPhone || !issue) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userName, userPhone, and issue are required.",
    });
  }

  try {
    const serviceTerms    = resolveServiceTerms(issue);
    const serviceRegexList = serviceTerms.map((t) => new RegExp(`^${t}$`, "i"));


    const baseQuery = {
      service: { $in: serviceRegexList },
      status:  { $in: ["Active", "active", "Approved", "approved"] },
    };

    const rawCity      = userCity || userAddress || "";
    const resolvedCity = extractCity(rawCity);

    console.log(`[SOS] rawCity="${rawCity}" → resolvedCity="${resolvedCity}" | issue="${issue}"`);

    let workers       = [];
    let matchedInCity = false;

    if (resolvedCity) {
      const cityRegex = new RegExp(resolvedCity.trim(), "i");

      // Step 1 — Online workers in the user's city
      workers = await Worker.find({ ...baseQuery, location: cityRegex, isOnline: true })
        .sort({ rating: -1, completedTasks: -1 });
      console.log(`[SOS] Step1 online+city (${resolvedCity}): ${workers.length}`);

      // Step 2 — Any active worker in city (online or offline)
      if (workers.length === 0) {
        workers = await Worker.find({ ...baseQuery, location: cityRegex })
          .sort({ isOnline: -1, rating: -1, completedTasks: -1 });
        console.log(`[SOS] Step2 any+city (${resolvedCity}): ${workers.length}`);
      }

      if (workers.length > 0) matchedInCity = true;
    }

    // Step 3 — Nationwide online fallback
    if (workers.length === 0) {
      workers = await Worker.find({ ...baseQuery, isOnline: true })
        .sort({ rating: -1, completedTasks: -1 });
      console.log(`[SOS] Step3 nationwide online: ${workers.length}`);
    }

    // Step 4 — Any active worker nationwide
    if (workers.length === 0) {
      workers = await Worker.find(baseQuery).sort({ rating: -1, completedTasks: -1 });
      console.log(`[SOS] Step4 nationwide any: ${workers.length}`);
    }

    if (workers.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No available ${issue} worker found. Please try again or call us directly.`,
      });
    }

    const assignedWorker = workers[0];

    const booking = await Booking.create({
      name:        userName,
      phone:       userPhone,
      serviceType: issue,
      location:    userAddress || userCity || "Not specified",
      bookingDate: new Date().toLocaleDateString("en-IN"),
      bookingTime: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      workerId:    assignedWorker._id,
      assignedAt:  new Date(),
      status:      "Assigned",
      notifications: { workerNotified: false, adminNotified: false },
    });

    await Worker.findByIdAndUpdate(assignedWorker._id, {
      $set: {
        notification: `EMERGENCY: ${issue} request from ${userName} (${userPhone}) in ${resolvedCity || userCity || "your area"}. Booking ID: ${booking._id}`,
      },
    });

    const workerCity    = extractCity(assignedWorker.location || "");
    const isLocalWorker = resolvedCity &&
      workerCity.toLowerCase() === resolvedCity.toLowerCase();

    return res.status(200).json({
      success: true,
      message: isLocalWorker
        ? "SOS triggered successfully. A worker has been assigned."
        : `SOS triggered. No worker available in ${resolvedCity} — nearest worker assigned.`,
      worker: {
        name:           assignedWorker.name,
        phone:          assignedWorker.phone,
        service:        assignedWorker.service,
        location:       assignedWorker.location,
        rating:         assignedWorker.rating,
        experience:     assignedWorker.experience,
        profileImage:   assignedWorker.profileImage,
        completedTasks: assignedWorker.completedTasks,
      },
      bookingId:     booking._id,
      matchedInCity,
    });

  } catch (err) {
    console.error("[SOS ERROR]", err);
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred. Please try again.",
      detail:  process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

export default router;