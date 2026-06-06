import express from "express";
import Worker from "../models/Worker.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { otpStore } from "./otpRoutes.js";
import { calculateWorkerPriceRange, normalizeServicePricing } from "../utils/pricingHelper.js";
import { encrypt, decrypt } from "../utils/crypto.js";

const router = express.Router();

// Helper to resolve fuzzy search service synonyms
const getServiceTerms = (service) => {
  if (!service) return [];
  
  let clean = service.toLowerCase().trim();
  
  // Clean punctuation and double spaces
  clean = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ").replace(/\s+/g, " ").trim();
  const cleanSpaceless = clean.replace(/\s+/g, "");
  
  // Typo Tolerances
  const typos = {
    "repari": "repair",
    "electical": "electrical",
    "electican": "electrician",
    "plumbin": "plumbing",
    "carpentri": "carpentry",
    "clen": "clean",
    "celan": "clean",
    "serivce": "service",
    "servise": "service",
    "electricals": "electrical",
    "plumbers": "plumber",
    "carpenters": "carpenter",
    "cleaners": "cleaner"
  };
  
  for (const [typo, replacement] of Object.entries(typos)) {
    clean = clean.replace(new RegExp(typo, "g"), replacement);
  }
  
  const terms = [clean];
  
  // Synonym & space-insensitive mappings for Tamil Nadu services
  const sLower = clean;
  const sSpaceless = cleanSpaceless;
  
  // 1. Electrician / Electrical Repair / Wiring
  if (sLower.includes("electr") || sLower.includes("wire") || sLower.includes("wiring") || 
      sLower.includes("power") || sLower.includes("fan") || sLower.includes("light") || 
      sLower.includes("switch") || sLower.includes("current") || sSpaceless.includes("electrician") || 
      sSpaceless.includes("electricalrepair") || sSpaceless.includes("wiringwork")) {
    terms.push("Electrician", "electrical", "electrical repair", "Electrical Repair", "Wiring", "Wiring Works");
  }
  
  // 2. Cleaning / Housekeeping
  if (sLower.includes("clean") || sLower.includes("maid") || sLower.includes("housekeep") || 
      sLower.includes("sweeper") || sLower.includes("sofa") || sSpaceless.includes("homecleaning") || 
      sSpaceless.includes("housecleaning")) {
    terms.push("homeclean", "cleaning", "home cleaning", "Home Cleaning", "Cleaning", "Cleaner");
  }
  
  // 3. AC Service / Fridge / Cooling
  if (sLower.includes("ac ") || sLower === "ac" || sLower.includes("air") || sLower.includes("cool") || 
      sLower.includes("fridge") || sLower.includes("refriger") || sSpaceless.includes("acservice") || 
      sSpaceless.includes("acrepair") || sSpaceless.includes("actechnician")) {
    terms.push("AC Repair", "ac", "ac service", "AC Service", "AC Technician");
  }
  
  // 4. Carpenter / Carpentry / Woodwork
  if (sLower.includes("carp") || sLower.includes("wood") || sLower.includes("furnit") || 
      sLower.includes("door") || sLower.includes("window") || sSpaceless.includes("carpentry") || 
      sSpaceless.includes("woodwork") || sSpaceless.includes("carpenterwork")) {
    terms.push("Carpenter", "carpentrywork", "carpentry", "Carpentry", "Wood Work");
  }
  
  // 5. Plumber / Plumbing
  if (sLower.includes("plumb") || sLower.includes("pipe") || sLower.includes("water") || 
      sLower.includes("leak") || sLower.includes("tap") || sLower.includes("basin") || 
      sSpaceless.includes("plumbing") || sSpaceless.includes("plumbingwork")) {
    terms.push("Plumber", "plumbing", "Plumbing", "Plumbing Work");
  }
  
  // 6. Pest Control
  if (sLower.includes("pest") || sLower.includes("bug") || sLower.includes("termite") || 
      sLower.includes("insect") || sLower.includes("rodent") || sLower.includes("rat") || 
      sSpaceless.includes("pestcontrol")) {
    terms.push("Pest Control", "pestcontrol", "Pest Control");
  }
  
  const uniqueTerms = [];
  const seen = new Set();
  for (const term of terms) {
    const tLower = term.toLowerCase();
    if (!seen.has(tLower)) {
      seen.add(tLower);
      uniqueTerms.push(term);
    }
  }
  return uniqueTerms;
};

// Simple Levenshtein distance helper
const getLevenshteinDistance = (a, b) => {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

const knownCities = [
  "Chennai", "Sattur", "Coimbatore", "Madurai", "Trichy", "Salem", 
  "Tirunelveli", "Palayamkottai", "Kovilpatti", "Sivakasi", 
  "Virudhunagar", "Thoothukudi", "Tuticorin", "Palani", "Dindigul",
  "Nagercoil", "Kanyakumari", "Erode", "Vellore", "Thanjavur", 
  "Hosur", "Karur", "Rajapalayam", "Sankaranayinarkoil", "Tenkasi"
];

const resolveFuzzyCity = (cityInput) => {
  if (!cityInput) return "";
  const input = cityInput.trim().toLowerCase();
  if (input === "nearby" || input === "near by") return "Nearby";
  
  // Direct matches
  for (const city of knownCities) {
    if (city.toLowerCase() === input) return city;
  }
  
  // Clean punctuation and common suffixes
  let cleanInput = input.replace(/\s+district$/i, "").replace(/\s+town$/i, "").replace(/\s+village$/i, "").trim();
  
  // Check for common typo mappings
  const commonCityTypos = {
    "satur": "Sattur",
    "sathur": "Sattur",
    "madruai": "Madurai",
    "madura": "Madurai",
    "chenai": "Chennai",
    "coimbator": "Coimbatore",
    "kovilpati": "Kovilpatti",
    "kovilpatty": "Kovilpatti",
    "tirunelvely": "Tirunelveli",
    "trichy": "Trichy",
    "trichi": "Trichy",
    "tuticorin": "Thoothukudi",
    "thoothukudi": "Thoothukudi",
    "sivakasi": "Sivakasi",
    "sivakashi": "Sivakasi",
    "virudhunagar": "Virudhunagar",
    "virudunagar": "Virudhunagar",
    "palayamkotai": "Palayamkottai",
    "palayankottai": "Palayamkottai"
  };
  
  if (commonCityTypos[cleanInput]) {
    return commonCityTypos[cleanInput];
  }
  
  // Calculate Levenshtein distance for fuzzy matching
  let bestMatch = cityInput;
  let minDistance = 3; // allow up to 2 changes
  
  for (const city of knownCities) {
    const cLower = city.toLowerCase();
    const dist = getLevenshteinDistance(cleanInput, cLower);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = city;
    }
  }
  
  return bestMatch;
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

// Fix AC workers status
router.get("/fix-ac-workers", async (req, res) => {
  try {
    const result = await Worker.updateMany(
      { service: "AC Service" },
      { $set: { status: "Active" } }
    );

    res.json({
      success: true,
      message: "AC workers updated successfully",
      result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Register worker
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email.trim().toLowerCase();

    // Check if worker already exists
    const existingWorker = await Worker.findOne({ email: cleanEmail });
    if (existingWorker) {
      return res.status(400).json({ success: false, message: "Worker already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password.trim(), salt);

    const { minPrice, maxPrice } = calculatePricingRange(req.body);

    // Encrypt sensitive bank account number if provided
    let encryptedBankDetails = undefined;
    if (req.body.bankDetails) {
      encryptedBankDetails = { ...req.body.bankDetails };
      if (encryptedBankDetails.accountNumber) {
        encryptedBankDetails.accountNumber = encrypt(encryptedBankDetails.accountNumber.trim());
      }
    }

    const newWorker = new Worker({
      ...req.body,
      email: cleanEmail,
      password: hashedPassword,
      bankDetails: encryptedBankDetails,
      status: req.body.status || "Pending",
      notification: req.body.notification || (req.body.status === "Active" ? "Account active" : "Account submitted for approval"),
      minPrice,
      maxPrice,
      profilePricing: { min: minPrice, max: maxPrice },
    });

    await newWorker.save();

    res.status(201).json({
      success: true,
      message: "Registration successful",
      worker: newWorker,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Get workers by service
router.get("/by-service/:service", async (req, res) => {
  try {
    const serviceParam = req.params.service;
    const serviceTerms = getServiceTerms(serviceParam);

    const workers = await Worker.find({
      service: { $in: serviceTerms.map(term => new RegExp("^" + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$", "i")) },
      status: { $in: ["Active", "active", "Approved", "approved"] },
    }).sort({ isOnline: -1 });

    const processedWorkers = await Promise.all(workers.map(async worker => {
      let wObj = worker.toObject ? worker.toObject() : worker;
      wObj.servicePricing = normalizeServicePricing(wObj.servicePricing, wObj.service, getDefaultServicePricing);
      const { minPrice, maxPrice } = calculatePricingRange(wObj);
      wObj.minPrice = minPrice;
      wObj.maxPrice = maxPrice;
      wObj.profilePricing = { min: minPrice, max: maxPrice };

      // Auto-save backfill in DB (non-blocking, run in background)
      if (!worker.profilePricing || !worker.profilePricing.min || !worker.servicePricing || worker.servicePricing.length === 0 || worker.servicePricing.some(item => !item.priceRange)) {
        Worker.findByIdAndUpdate(wObj._id, {
          servicePricing: wObj.servicePricing,
          minPrice,
          maxPrice,
          profilePricing: wObj.profilePricing
        }).catch(err => console.error("Pricing backfill background update failed:", err.message));
      }
      return wObj;
    }));

    res.json({
      success: true,
      workers: processedWorkers,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get("/search", async (req, res) => {
  try {
    let { city, service } = req.query;

    const resolvedCity = city ? resolveFuzzyCity(city) : "";

    const queryObj = {
      status: { $in: ["Active", "active", "Approved", "approved"] }
    };

    if (service) {
      const escapedService = service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const serviceTerms = getServiceTerms(service);
      const orConditions = [];

      if (serviceTerms.length > 0) {
        orConditions.push({
          service: { $in: serviceTerms.map(term => new RegExp("^" + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$", "i")) }
        });
      } else {
        orConditions.push({
          service: new RegExp(escapedService, "i")
        });
      }

      // Also match worker name for shop/worker name search
      orConditions.push({
        name: new RegExp(escapedService, "i")
      });

      queryObj.$or = orConditions;
    }

    if (resolvedCity) {
      // Create a regex to match resolved city or the original searched city
      const cityPattern = [resolvedCity, city].filter(Boolean).map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|");
      queryObj.location = new RegExp(cityPattern, "i");
    }

    const workers = await Worker.find(queryObj);

    // Dynamic Relevance Scoring on the backend!
    const scoredWorkers = workers.map(worker => {
      let score = 0;
      
      // 1. Exact City Match Boost
      if (resolvedCity) {
        const wLoc = (worker.location || "").toLowerCase();
        if (wLoc.includes(resolvedCity.toLowerCase())) {
          score += 5;
        } else if (city && wLoc.includes(city.toLowerCase())) {
          score += 3;
        }
      }
      
      // 2. Online Boost
      if (worker.isOnline === true) {
        score += 3;
      }
      
      // 3. Service/Name exact match boost
      if (service) {
        const sLower = service.toLowerCase();
        if ((worker.service || "").toLowerCase() === sLower) {
          score += 4;
        }
        if ((worker.name || "").toLowerCase().includes(sLower)) {
          score += 2;
        }
      }
      
      // 4. Rating contribution
      const rating = parseFloat(worker.rating) || 0;
      score += rating / 10;
      
      return { worker, score };
    });

    // Sort by relevance score descending
    scoredWorkers.sort((a, b) => b.score - a.score);

    const processedWorkers = await Promise.all(scoredWorkers.map(async sw => {
      let wObj = sw.worker.toObject ? sw.worker.toObject() : sw.worker;
      wObj.servicePricing = normalizeServicePricing(wObj.servicePricing, wObj.service, getDefaultServicePricing);
      const { minPrice, maxPrice } = calculatePricingRange(wObj);
      wObj.minPrice = minPrice;
      wObj.maxPrice = maxPrice;
      wObj.profilePricing = { min: minPrice, max: maxPrice };

      // Auto-save backfill in DB (non-blocking, run in background)
      if (!sw.worker.profilePricing || !sw.worker.profilePricing.min || !sw.worker.servicePricing || sw.worker.servicePricing.length === 0 || sw.worker.servicePricing.some(item => !item.priceRange)) {
        Worker.findByIdAndUpdate(wObj._id, {
          servicePricing: wObj.servicePricing,
          minPrice,
          maxPrice,
          profilePricing: wObj.profilePricing
        }).catch(err => console.error("Pricing backfill background update failed:", err.message));
      }
      return wObj;
    }));

    res.json({
      success: true,
      workers: processedWorkers,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Search failed",
    });
  }
});

// Global search
router.get("/global-search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json({ success: true, workers: [] });
    }

    let serviceRegex = "";
    let cityRegex = "";
    
    // Check if query is in format "Service from City" or "Service in City"
    const parts = q.split(/ from | in /i);
    if (parts.length === 2) {
      serviceRegex = parts[0].trim();
      cityRegex = parts[1].trim();
    } else {
      cityRegex = q.trim();
    }

    const queryObj = { status: { $in: ["Active", "approved", "active"] } };
    
    if (serviceRegex && cityRegex) {
      queryObj.service = new RegExp(serviceRegex, "i");
      queryObj.location = new RegExp(cityRegex, "i");
    } else if (cityRegex) {
      const regex = new RegExp(cityRegex, "i");
      queryObj.$or = [
        { location: regex },
        { service: regex },
        { name: regex }
      ];
    }

    const workers = await Worker.find(queryObj).sort({ isOnline: -1 });

    const processedWorkers = workers.map(worker => {
      const wObj = worker.toObject ? worker.toObject() : worker;
      const { minPrice, maxPrice } = calculatePricingRange(wObj);
      wObj.minPrice = minPrice;
      wObj.maxPrice = maxPrice;
      wObj.profilePricing = { min: minPrice, max: maxPrice };
      return wObj;
    });

    res.json({
      success: true,
      workers: processedWorkers,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Global search failed",
    });
  }
});

// Get pending workers
router.get("/pending", async (req, res) => {
  try {
    const workers = await Worker.find({ status: "Pending" })
      .select("name email phone service location status")
      .lean();

    res.json({
      success: true,
      workers,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Get worker by ID (or all workers if id = "all")
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ SPECIAL CASE: if frontend requests "/all", return all workers
    if (id === "all") {
      const workers = await Worker.find({})
        .select("name email phone service location status")
        .lean();
      return res.json({
        success: true,
        workers: workers,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID format",
      });
    }

    const worker = await Worker.findById(id);

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    let wObj = worker.toObject ? worker.toObject() : worker;
    wObj.servicePricing = normalizeServicePricing(wObj.servicePricing, wObj.service, getDefaultServicePricing);
    const { minPrice, maxPrice } = calculatePricingRange(wObj);
    wObj.minPrice = minPrice;
    wObj.maxPrice = maxPrice;
    wObj.profilePricing = { min: minPrice, max: maxPrice };
    if (wObj.bankDetails && wObj.bankDetails.accountNumber) {
      wObj.bankDetails.accountNumber = decrypt(wObj.bankDetails.accountNumber);
    }

    // Auto-save backfill in DB (non-blocking, run in background)
    if (!worker.profilePricing || !worker.profilePricing.min || !worker.servicePricing || worker.servicePricing.length === 0 || worker.servicePricing.some(item => !item.priceRange)) {
      Worker.findByIdAndUpdate(id, {
        servicePricing: wObj.servicePricing,
        minPrice,
        maxPrice,
        profilePricing: wObj.profilePricing
      }).catch(err => console.error("Pricing backfill background update failed:", err.message));
    }

    res.json({
      success: true,
      worker: wObj,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Update worker
router.put("/update/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID format",
      });
    }

    if (req.body._id) {
      delete req.body._id;
    }

    const { min: minPrice, max: maxPrice } = calculateWorkerPriceRange(req.body.servicePricing);
    req.body.minPrice = minPrice;
    req.body.maxPrice = maxPrice;
    req.body.profilePricing = { min: minPrice, max: maxPrice };

    if (req.body.bankDetails && req.body.bankDetails.accountNumber) {
      req.body.bankDetails.accountNumber = encrypt(req.body.bankDetails.accountNumber.trim());
    }

    const updatedWorker = await Worker.findByIdAndUpdate(
      req.params.id,
      req.body,
      { returnDocument: 'after' }
    );

    if (!updatedWorker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    let updatedWorkerObj = updatedWorker.toObject ? updatedWorker.toObject() : updatedWorker;
    if (updatedWorkerObj.bankDetails && updatedWorkerObj.bankDetails.accountNumber) {
      updatedWorkerObj.bankDetails.accountNumber = decrypt(updatedWorkerObj.bankDetails.accountNumber);
    }

    res.json({
      success: true,
      worker: updatedWorkerObj,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Toggle Online Status
router.put("/toggle-status/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid worker ID" });
    }

    const { isOnline } = req.body;

    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      { isOnline },
      { returnDocument: 'after' }
    );

    if (!worker) {
      return res.status(404).json({ success: false, message: "Worker not found" });
    }

    res.json({
      success: true,
      worker,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Approve worker
router.put("/approve/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID format",
      });
    }

    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      {
        status: "Active",
        notification: "Your account has been approved ✅",
      },
      { returnDocument: 'after' }
    );

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    res.json({
      success: true,
      worker,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Reject worker
router.put("/reject/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID format",
      });
    }

    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      {
        status: "Rejected",
        notification: "Your request was rejected",
      },
      { returnDocument: 'after' }
    );

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    res.json({
      success: true,
      worker,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Delete worker
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID format",
      });
    }

    const worker = await Worker.findByIdAndDelete(req.params.id);

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
      });
    }

    res.json({
      success: true,
      message: "Worker deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Worker login
router.post("/login", async (req, res) => {
  console.log("=> POST /api/workers/login hit", req.body);
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      console.log("Missing fields");
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("Searching for worker with email:", email.trim().toLowerCase());
    const worker = await Worker.findOne({
      email: email.trim().toLowerCase(),
    });

    console.log("Worker found:", worker ? "yes" : "no");
    if (!worker) {
      return res.status(401).json({
        success: false,
        message: "No user found",
      });
    }

    const storedPassword = (worker.password || "").trim();
    const inputPassword = password.trim();
    let isMatch = false;

    // Check if stored password is a bcrypt hash
    if (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2y$")) {
      isMatch = await bcrypt.compare(inputPassword, storedPassword);
    } else {
      // Fallback for pre-existing plain text passwords
      isMatch = storedPassword === inputPassword;
    }

    if (!isMatch) {
      console.log("Password mismatch");
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    // Only allow explicitly authorized statuses
    const activeStatuses = ["active", "approved", "Active", "Approved"];
    if (!worker.status || !activeStatuses.includes(worker.status)) {
      const isRejected = worker.status === "Rejected" || worker.status?.toLowerCase() === "rejected";
      const msg = isRejected 
        ? "Your account has been deactivated by admin." 
        : "Waiting for admin approval.";
      
      return res.status(403).json({
        success: false,
        message: msg,
      });
    }

    console.log("Login successful");
    // Update worker status and last active time in DB in background (non-blocking)
    Worker.updateOne(
      { _id: worker._id },
      { $set: { isOnline: true, lastActive: Date.now() } }
    ).catch(err => console.error("Worker login status update failed:", err.message));

    worker.isOnline = true;
    worker.lastActive = Date.now();

    let workerObj = worker.toObject ? worker.toObject() : worker;
    if (workerObj.bankDetails && workerObj.bankDetails.accountNumber) {
      workerObj.bankDetails.accountNumber = decrypt(workerObj.bankDetails.accountNumber);
    }

    res.json({
      success: true,
      worker: workerObj,
    });
  } catch (err) {
    console.error("Worker Login Exception:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


router.put("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;
  try {
    if (!email || !newPassword) {
      return res.status(400).json({ success: false, message: "Email and new password are required" });
    }
    
    const cleanEmail = email.trim().toLowerCase();
    
    // 1. Verify OTP validation status in backend
    const storedData = otpStore.get(cleanEmail);
    if (!storedData || !storedData.isVerified) {
      return res.status(400).json({ success: false, message: "OTP verification required or expired" });
    }
    
    // 2. Find Worker
    const worker = await Worker.findOne({ email: cleanEmail });
    if (!worker) {
      return res.status(404).json({ success: false, message: "Worker not found" });
    }
    
    // 3. Hash the new password and update
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword.trim(), salt);
    worker.password = hashedPassword;
    await worker.save();
    
    // 4. Clean up OTP store
    otpStore.delete(cleanEmail);
    
    // 5. Verification check to ensure it was successfully updated in DB
    const updatedWorker = await Worker.findOne({ email: cleanEmail });
    if (updatedWorker.password !== hashedPassword) {
      return res.status(500).json({ success: false, message: "Database update verification failed" });
    }
    
    return res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Worker reset password error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;