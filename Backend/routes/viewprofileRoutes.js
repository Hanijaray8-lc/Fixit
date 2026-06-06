import express from "express";
import Worker from "../models/Worker.js";
import Feedback from "../models/Feedback.js";
import User from "../models/UserModels.js";
import { calculateWorkerPriceRange, normalizeServicePricing } from "../utils/pricingHelper.js";

const router = express.Router();

const attachPremiumStatusToFeedbacks = async (feedbacks) => {
  if (!feedbacks || feedbacks.length === 0) return feedbacks;
  
  const reviewerNames = feedbacks.map(f => f.userName).filter(Boolean);
  const uniqueNames = [...new Set(reviewerNames)];
  
  const premiumUsers = await User.find({
    name: { $in: uniqueNames },
    $or: [{ premiumMember: true }, { isPremium: true }]
  }).select("name");
  
  const premiumNames = new Set(premiumUsers.map(u => u.name.toLowerCase().trim()));
  
  return feedbacks.map(fb => {
    const fbObj = fb.toObject ? fb.toObject() : fb;
    const isPremiumUser = fbObj.userName ? premiumNames.has(fbObj.userName.toLowerCase().trim()) : false;
    return { ...fbObj, isPremiumUser };
  });
};

const getDefaultServicePricing = (serviceName) => {
  let normalized = "Electrical";
  const sLower = String(serviceName || "").toLowerCase();
  if (sLower.includes("electr") || sLower.includes("wire")) normalized = "Electrical";
  else if (sLower.includes("plumb")) normalized = "Plumbing";
  else if (sLower.includes("clean") || sLower.includes("maid")) normalized = "Cleaning";
  else if (sLower.includes("ac ") || sLower === "ac" || sLower.includes("air")) normalized = "AC Service";
  else if (sLower.includes("carp") || sLower.includes("wood")) normalized = "Carpentry";
  else if (sLower.includes("pest")) normalized = "Pest Control";

  const lists = {
    Electrical: [
      { work: "Fan Repair", defaultPrice: 200, workerPrice: 200, priceRange: { min: 200, max: 350 } },
      { work: "Switch Board Repair", defaultPrice: 150, workerPrice: 150, priceRange: { min: 150, max: 300 } },
      { work: "Tube Light Fix", defaultPrice: 100, workerPrice: 100, priceRange: { min: 100, max: 200 } },
      { work: "Wiring Work", defaultPrice: 500, workerPrice: 500, priceRange: { min: 500, max: 1200 } },
    ],
    Plumbing: [
      { work: "Tap Repair", defaultPrice: 150, workerPrice: 150, priceRange: { min: 150, max: 300 } },
      { work: "Pipe Leakage Fix", defaultPrice: 400, workerPrice: 400, priceRange: { min: 400, max: 800 } },
      { work: "Basin Installation", defaultPrice: 600, workerPrice: 600, priceRange: { min: 600, max: 1200 } },
      { work: "Water Tank Cleaning", defaultPrice: 800, workerPrice: 800, priceRange: { min: 800, max: 1800 } },
    ],
    Cleaning: [
      { work: "Basic House Cleaning", defaultPrice: 800, workerPrice: 800, priceRange: { min: 800, max: 1500 } },
      { work: "Deep Kitchen Cleaning", defaultPrice: 1200, workerPrice: 1200, priceRange: { min: 1200, max: 2500 } },
      { work: "Bathroom Cleaning", defaultPrice: 300, workerPrice: 300, priceRange: { min: 300, max: 600 } },
      { work: "Sofa Dry Cleaning", defaultPrice: 400, workerPrice: 400, priceRange: { min: 400, max: 1000 } },
    ],
    "AC Service": [
      { work: "AC Wet Filter Service", defaultPrice: 400, workerPrice: 400, priceRange: { min: 400, max: 600 } },
      { work: "AC Gas Refill", defaultPrice: 2000, workerPrice: 2000, priceRange: { min: 2000, max: 3000 } },
      { work: "AC Installation", defaultPrice: 1200, workerPrice: 1200, priceRange: { min: 1200, max: 2000 } },
      { work: "AC Leak Repair", defaultPrice: 600, workerPrice: 600, priceRange: { min: 600, max: 1200 } },
    ],
    Carpentry: [
      { work: "Door Lock Repair", defaultPrice: 250, workerPrice: 250, priceRange: { min: 250, max: 500 } },
      { work: "Cabinet Handle Fix", defaultPrice: 100, workerPrice: 100, priceRange: { min: 100, max: 250 } },
      { work: "Hinge Adjustment", defaultPrice: 150, workerPrice: 150, priceRange: { min: 150, max: 350 } },
      { work: "Furniture Assembly", defaultPrice: 600, workerPrice: 600, priceRange: { min: 600, max: 1500 } },
    ],
    "Pest Control": [
      { work: "General Pest Control", defaultPrice: 800, workerPrice: 800, priceRange: { min: 800, max: 1500 } },
      { work: "Cockroach Treatment", defaultPrice: 600, workerPrice: 600, priceRange: { min: 600, max: 1200 } },
      { work: "Termite Treatment", defaultPrice: 2500, workerPrice: 2500, priceRange: { min: 2500, max: 5000 } },
      { work: "Bed Bug Treatment", defaultPrice: 1200, workerPrice: 1200, priceRange: { min: 1200, max: 2200 } },
    ],
  };

  return lists[normalized] || lists["Electrical"];
};

const calculatePricingRange = (worker) => {
  let servicePricing = worker.servicePricing;
  
  if (!servicePricing || servicePricing.length === 0) {
    servicePricing = getDefaultServicePricing(worker.service);
  }
  
  const range = calculateWorkerPriceRange(servicePricing);
  
  return {
    minPrice: range.min,
    maxPrice: range.max
  };
};

// 🔥 GET SINGLE WORKER FULL PROFILE
router.get("/:id", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    // Ensure servicePricing is auto-populated if empty/missing
    let workerObj = worker.toObject();
    workerObj.servicePricing = normalizeServicePricing(workerObj.servicePricing, workerObj.service, getDefaultServicePricing);
    const { minPrice, maxPrice } = calculatePricingRange(workerObj);
    workerObj.minPrice = minPrice;
    workerObj.maxPrice = maxPrice;
    workerObj.profilePricing = { min: minPrice, max: maxPrice };

    // Auto-save backfill in DB
    if (!worker.profilePricing || !worker.profilePricing.min || !worker.servicePricing || worker.servicePricing.length === 0 || worker.servicePricing.some(item => !item.priceRange)) {
      await Worker.findByIdAndUpdate(req.params.id, {
        servicePricing: workerObj.servicePricing,
        minPrice,
        maxPrice,
        profilePricing: workerObj.profilePricing
      });
    }

    // Fetch standalone legacy feedbacks registered under the worker's email
    let standaloneFeedbacks = [];
    if (worker.email) {
      try {
        const found = await Feedback.find({
          workerEmail: worker.email.toLowerCase().trim()
        }).lean();

        standaloneFeedbacks = found.map(fb => ({
          userName: fb.customerName,
          message: fb.comment,
          stars: fb.rating || 5,
          image: fb.image || null,
          createdAt: fb.createdAt || new Date()
        }));
      } catch (e) {
        console.log("Error pulling standalone feedbacks:", e);
      }
    }

    // Combine embedded list with standalone list, filtering out duplicates robustly
    const clean = (str) => String(str || "").toLowerCase().trim();
    const allFeedbacks = [...(workerObj.feedbacks || [])];
    standaloneFeedbacks.forEach(sf => {
      let existingDup = null;
      const isDup = allFeedbacks.some(ef => {
        const isTextDup = clean(ef.userName) === clean(sf.userName) && clean(ef.message) === clean(sf.message);
        if (isTextDup) {
          existingDup = ef;
          return true;
        }
        const timeDiff = ef.createdAt && sf.createdAt ? Math.abs(new Date(ef.createdAt) - new Date(sf.createdAt)) : null;
        if (clean(ef.userName) === clean(sf.userName) && timeDiff !== null && timeDiff < 60000) {
          existingDup = ef;
          return true;
        }
        return false;
      });

      if (isDup) {
        // Safe Merge: If the standalone feedback has an image, preserve it in the merged output
        if (sf.image && existingDup && !existingDup.image) {
          existingDup.image = sf.image;
        }
      } else {
        allFeedbacks.push(sf);
      }
    });
    
    // Sort chronologically (newest first)
    allFeedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const feedbacksWithPremium = await attachPremiumStatusToFeedbacks(allFeedbacks);
    workerObj.feedbacks = feedbacksWithPremium;
    workerObj.totalReviews = feedbacksWithPremium.length;
    
    if (allFeedbacks.length > 0) {
      const sum = allFeedbacks.reduce((acc, fb) => acc + (Number(fb.stars) || 0), 0);
      workerObj.rating = Number((sum / allFeedbacks.length).toFixed(1));
    } else {
      workerObj.rating = 0;
    }

    res.status(200).json({
      success: true,
      worker: workerObj,
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});

// 🔥 ADD FEEDBACK & AUTO-RECALCULATE STATS
router.post("/:id/feedback", async (req, res) => {
  try {
    const { userName, message, stars, image } = req.body;
    const workerId = req.params.id;

    if (!userName || !message) {
      return res.status(400).json({
        success: false,
        message: "Name and message are required.",
      });
    }

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found.",
      });
    }

    const trimmedUserName = String(userName || "").trim();
    const trimmedMessage = String(message || "").trim();
    const clean = (str) => String(str || "").toLowerCase().trim();

    // Backend Duplicate Protection (60-second threshold)
    const duplicateEmbedded = worker.feedbacks.some(fb => 
      clean(fb.userName) === clean(trimmedUserName) && 
      clean(fb.message) === clean(trimmedMessage) && 
      (new Date() - new Date(fb.createdAt)) < 60000
    );

    if (duplicateEmbedded) {
      console.log("Blocked duplicate feedback in Worker feedbacks array");
      
      // Fetch standalone legacy feedbacks to include in the response
      let standaloneFeedbacks = [];
      if (worker.email) {
        try {
          const found = await Feedback.find({
            workerEmail: worker.email.toLowerCase().trim()
          }).lean();

          standaloneFeedbacks = found.map(fb => ({
            userName: fb.customerName,
            message: fb.comment,
            stars: fb.rating || 5,
            image: fb.image || null,
            createdAt: fb.createdAt || new Date()
          }));
        } catch (e) {
          console.log("Error pulling standalone feedbacks:", e);
        }
      }

      const workerObj = worker.toObject();
      // Combine embedded list with standalone list, filtering out duplicates robustly
      const allFeedbacks = [...(workerObj.feedbacks || [])];
      standaloneFeedbacks.forEach(sf => {
        let existingDup = null;
        const isDup = allFeedbacks.some(ef => {
          const isTextDup = clean(ef.userName) === clean(sf.userName) && clean(ef.message) === clean(sf.message);
          if (isTextDup) {
            existingDup = ef;
            return true;
          }
          const timeDiff = ef.createdAt && sf.createdAt ? Math.abs(new Date(ef.createdAt) - new Date(sf.createdAt)) : null;
          if (clean(ef.userName) === clean(sf.userName) && timeDiff !== null && timeDiff < 60000) {
            existingDup = ef;
            return true;
          }
          return false;
        });

        if (isDup) {
          // Safe Merge: If the standalone feedback has an image, preserve it in the merged output
          if (sf.image && existingDup && !existingDup.image) {
            existingDup.image = sf.image;
          }
        } else {
          allFeedbacks.push(sf);
        }
      });

      allFeedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      const feedbacksWithPremium = await attachPremiumStatusToFeedbacks(allFeedbacks);
      workerObj.feedbacks = feedbacksWithPremium;
      workerObj.totalReviews = feedbacksWithPremium.length;
      if (allFeedbacks.length > 0) {
        const sum = allFeedbacks.reduce((acc, fb) => acc + (Number(fb.stars) || 0), 0);
        workerObj.rating = Number((sum / allFeedbacks.length).toFixed(1));
      } else {
        workerObj.rating = 0;
      }

      return res.status(201).json({
        success: true,
        message: "Feedback submitted successfully (duplicate ignored)",
        worker: workerObj,
      });
    }

    // Add new feedback to Worker document (properly normalized)
    const newFeedback = {
      userName: trimmedUserName,
      message: trimmedMessage,
      stars: Number(stars) || 5,
      image: image || null,
      createdAt: new Date()
    };

    worker.feedbacks.push(newFeedback);

    // Recalculate Stats
    worker.totalReviews = worker.feedbacks.length;
    const sumStars = worker.feedbacks.reduce((sum, item) => sum + (item.stars || 0), 0);
    worker.rating = Number((sumStars / worker.totalReviews).toFixed(1));

    await worker.save();

    // ALSO save to standalone Feedback collection as a fail-safe backup (including image!)
    try {
      const duplicateStandalone = await Feedback.findOne({
        workerEmail: worker.email ? worker.email.toLowerCase().trim() : "unknown@fixit.com",
        customerName: trimmedUserName,
        comment: trimmedMessage,
        createdAt: { $gte: new Date(Date.now() - 60000) }
      });

      if (!duplicateStandalone) {
        const standaloneFb = new Feedback({
          workerEmail: worker.email ? worker.email.toLowerCase().trim() : "unknown@fixit.com",
          workerName: worker.name || "Unknown",
          customerName: trimmedUserName,
          rating: Number(stars) || 5,
          comment: trimmedMessage,
          image: image || null,
        });
        await standaloneFb.save();
      } else {
        console.log("Blocked duplicate standalone feedback submission");
      }
    } catch (saveErr) {
      console.log("Error saving fail-safe standalone feedback:", saveErr);
    }

    // Fetch standalone legacy feedbacks to include in the refreshed response
    let standaloneFeedbacks = [];
    if (worker.email) {
      try {
        const found = await Feedback.find({
          workerEmail: worker.email.toLowerCase().trim()
        }).lean();

        standaloneFeedbacks = found.map(fb => ({
          userName: fb.customerName,
          message: fb.comment,
          stars: fb.rating || 5,
          image: fb.image || null,
          createdAt: fb.createdAt || new Date()
        }));
      } catch (e) {
        console.log("Error pulling standalone feedbacks:", e);
      }
    }

    const workerObj = worker.toObject();
    // Combine embedded list with standalone list, filtering out duplicates robustly
    const allFeedbacks = [...(workerObj.feedbacks || [])];
    standaloneFeedbacks.forEach(sf => {
      let existingDup = null;
      const isDup = allFeedbacks.some(ef => {
        const isTextDup = clean(ef.userName) === clean(sf.userName) && clean(ef.message) === clean(sf.message);
        if (isTextDup) {
          existingDup = ef;
          return true;
        }
        const timeDiff = ef.createdAt && sf.createdAt ? Math.abs(new Date(ef.createdAt) - new Date(sf.createdAt)) : null;
        if (clean(ef.userName) === clean(sf.userName) && timeDiff !== null && timeDiff < 60000) {
          existingDup = ef;
          return true;
        }
        return false;
      });

      if (isDup) {
        // Safe Merge: If the standalone feedback has an image, preserve it in the merged output
        if (sf.image && existingDup && !existingDup.image) {
          existingDup.image = sf.image;
        }
      } else {
        allFeedbacks.push(sf);
      }
    });

    allFeedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const feedbacksWithPremium = await attachPremiumStatusToFeedbacks(allFeedbacks);
    workerObj.feedbacks = feedbacksWithPremium;
    workerObj.totalReviews = feedbacksWithPremium.length;
    if (allFeedbacks.length > 0) {
      const sum = allFeedbacks.reduce((acc, fb) => acc + (Number(fb.stars) || 0), 0);
      workerObj.rating = Number((sum / allFeedbacks.length).toFixed(1));
    } else {
      workerObj.rating = 0;
    }

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully!",
      worker: workerObj,
    });

  } catch (err) {
    console.error("Error adding feedback:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

export default router;