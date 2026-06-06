import express from "express";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ─── Built-in fallback keyword diagnosis ─────────────────────────────────────
const FALLBACK_MAP = [
  {
    keywords: ["fan installation"],
    causes: ["Loose wiring connections", "Faulty ceiling mount bracket", "Wrong voltage supply"],
    service: "Fan Installation & Repair — a licensed electrician will inspect wiring, fix the mount, and test voltage.",
    urgency: "Medium",
  },
  {
    keywords: ["fan"],
    causes: ["Capacitor failure", "Worn-out motor bearings", "Loose blade screws"],
    service: "Fan Repair — capacitor/motor bearing replacement and blade tightening.",
    urgency: "Low",
  },
  {
    keywords: ["light fitting", "light"],
    causes: ["Broken holder socket", "Loose neutral wire", "Short circuit"],
    service: "Light Fitting — socket replacement and safe rewiring by a certified electrician.",
    urgency: "Medium",
  },
  {
    keywords: ["house wiring", "wiring"],
    causes: ["Aging insulation", "Overloaded circuit", "Rodent damage to cables"],
    service: "House Rewiring — full cable inspection and replacement with ISI-approved wires.",
    urgency: "High",
  },
  {
    keywords: ["switchboard"],
    causes: ["Loose terminal screws", "Burned contacts", "Overheating due to overload"],
    service: "Switchboard Repair — terminal tightening and contact cleaning/replacement.",
    urgency: "Medium",
  },
  {
    keywords: ["pipe replacement"],
    causes: ["Old galvanised iron pipes", "Root intrusion", "Freeze-thaw cracks"],
    service: "Pipe Replacement — full pipe assessment and uPVC/CPVC replacement.",
    urgency: "Medium",
  },
  {
    keywords: ["leak", "pipe"],
    causes: ["Corroded pipe joints", "Worn rubber seals", "High water pressure"],
    service: "Leak Repair — joint sealing, seal replacement, and pressure check.",
    urgency: "High",
  },
  {
    keywords: ["bathroom fitting", "bathroom"],
    causes: ["Old fixtures", "Improper installation", "Sealant failure around fittings"],
    service: "Bathroom Fitting — new fixture installation with water-tight sealant application.",
    urgency: "Low",
  },
  {
    keywords: ["water tank", "tank"],
    causes: ["Algae/bacterial growth", "Sediment accumulation", "Damaged float valve"],
    service: "Water Tank Cleaning — high-pressure washing, disinfection, and valve check.",
    urgency: "Medium",
  },
  {
    keywords: ["ac installation"],
    causes: ["Wrong bracket placement", "Refrigerant line too long", "Drain pipe slope issue"],
    service: "AC Installation — proper wall-bracket mounting, refrigerant line connection, and drain alignment.",
    urgency: "Low",
  },
  {
    keywords: ["cooling", "gas refill", "gas"],
    causes: ["Low refrigerant (gas leak)", "Dirty air filter", "Faulty compressor"],
    service: "Cooling Issue Repair — gas top-up, filter cleaning, and compressor diagnostics.",
    urgency: "High",
  },
  {
    keywords: ["ac uninstallation", "ac"],
    causes: ["Relocation requirement", "Unit upgrade", "Rented property move-out"],
    service: "AC Service — our certified technician will handle installation, repair, or uninstallation.",
    urgency: "Low",
  },
  {
    keywords: ["furniture repair", "furniture"],
    causes: ["Joint separation", "Damaged veneer", "Broken hinges or sliders"],
    service: "Furniture Repair — joint regluing, veneer patching, hardware replacement.",
    urgency: "Low",
  },
  {
    keywords: ["woodwork", "wood"],
    causes: ["Termite damage", "Moisture warping", "General wear and tear"],
    service: "General Woodwork — termite treatment, sanding, and refinishing.",
    urgency: "Medium",
  },
  {
    keywords: ["door"],
    causes: ["Swollen wood due to humidity", "Hinge misalignment", "Broken latch/lock"],
    service: "Door Repair — planing, hinge realignment, and lock replacement.",
    urgency: "Medium",
  },
  {
    keywords: ["window"],
    causes: ["Frame warping", "Broken glass pane", "Worn weatherstrip"],
    service: "Window Repair — frame realignment, glass replacement, and weatherstrip fitting.",
    urgency: "Low",
  },
  {
    keywords: ["modular kitchen", "kitchen deep", "kitchen"],
    causes: ["Grease build-up", "Cabinet hinge failure", "Chimney filter clogging"],
    service: "Kitchen Service — deep cleaning, hinge/slider replacement, and edge-banding repair.",
    urgency: "Medium",
  },
  {
    keywords: ["full home", "home clean", "home"],
    causes: ["Long gap since last cleaning", "Post-construction dust", "Pest residue"],
    service: "Full Home Deep Cleaning — high-pressure vacuum, steam mopping, and surface sanitisation.",
    urgency: "Low",
  },
  {
    keywords: ["bathroom deep"],
    causes: ["Hard water stains", "Mould growth", "Soap scum on tiles"],
    service: "Bathroom Deep Cleaning — acid wash for stains, anti-mould treatment, tile scrubbing.",
    urgency: "Low",
  },
  {
    keywords: ["sofa", "carpet"],
    causes: ["Embedded dust mites", "Stain penetration into foam", "Pet hair accumulation"],
    service: "Sofa/Carpet Cleaning — hot-water extraction, stain treatment, deodorisation.",
    urgency: "Low",
  },
  {
    keywords: ["cockroach"],
    causes: ["Food residue in cracks", "Moisture under sink", "Shared wall from neighbours"],
    service: "Cockroach Treatment — gel-bait placement and crack-sealing spray.",
    urgency: "High",
  },
  {
    keywords: ["termite"],
    causes: ["Wood-to-soil contact", "Moisture in foundation", "Old wooden structures"],
    service: "Termite Treatment — soil treatment and wood injection with termiticide.",
    urgency: "High",
  },
  {
    keywords: ["rodent", "rat", "mouse"],
    causes: ["Open food storage", "Entry gaps in walls/pipes", "Cluttered storage areas"],
    service: "Rodent Control — bait stations, snap traps, and entry-gap sealing.",
    urgency: "High",
  },
  {
    keywords: ["mosquito", "pest"],
    causes: ["Stagnant water nearby", "Unscreened windows", "Seasonal pest activity"],
    service: "Pest Control — comprehensive spray and fogging treatment for household pests.",
    urgency: "Medium",
  },
];

// Match WHOLE WORDS only — prevents "cockroach" matching keyword "ac"
function wordMatch(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i").test(text);
}

function getFallbackDiagnosis(issue) {
  const lower = issue.toLowerCase();
  for (const entry of FALLBACK_MAP) {
    if (entry.keywords.some((kw) => wordMatch(lower, kw))) {
      return { causes: entry.causes, service: entry.service, urgency: entry.urgency };
    }
  }
  return {
    causes: [
      "Wear and tear over time",
      "Improper previous installation or repair",
      "Environmental factors (dust, moisture, voltage fluctuation)",
    ],
    service: "A professional will inspect on-site and recommend the most appropriate repair or replacement.",
    urgency: "Medium",
  };
}


// ─── Route ────────────────────────────────────────────────────────────────────
router.post("/diagnose", async (req, res) => {
  const { issue } = req.body;
  console.log("[Diagnosis] Received:", issue);

  if (!issue || !issue.trim()) {
    return res.status(400).json({ success: false, message: "Issue is required" });
  }

  // ── 1. Try Gemini AI ───────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("[Diagnosis] API key present:", !!apiKey);

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const prompt = `You are a strict home service diagnosis expert for an Indian home services platform.

Your ONLY job is to analyze the given issue and return a JSON diagnosis.

STRICT SERVICE CATEGORY RULES — match the issue to EXACTLY ONE category:
- Cockroach / pest / termite / mosquito / rodent / rat / bedbug  →  service must mention "Pest Control"
- Fan / wiring / switchboard / light / electrical / circuit        →  service must mention "Electrical Repair"
- Leak / pipe / plumbing / bathroom fitting / water tank / tap     →  service must mention "Plumbing"
- AC / air conditioner / cooling / gas refill / compressor        →  service must mention "AC Service"
- Furniture / door / window / carpentry / woodwork / kitchen      →  service must mention "Carpentry"
- Cleaning / sofa / carpet / deep clean / home clean              →  service must mention "Cleaning Service"

User issue: "${issue}"

First identify the category. Then respond with ONLY this JSON (no markdown, no extra text):
{"causes":["specific cause 1","specific cause 2","specific cause 3"],"service":"Specific and relevant service recommendation matching the issue category","urgency":"Low or Medium or High"}`;

      const result = await model.generateContent(prompt);
      const rawText = result.response.text();
      console.log("[Diagnosis] Gemini raw:", rawText);

      const cleaned = rawText
        .replace(/^```(?:json)?\s*/im, "")
        .replace(/```\s*$/im, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      console.log("[Diagnosis] Gemini parsed OK:", parsed);

      return res.json({
        success: true,
        source: "ai",
        diagnosis: {
          causes: Array.isArray(parsed.causes) ? parsed.causes : getFallbackDiagnosis(issue).causes,
          service: parsed.service || getFallbackDiagnosis(issue).service,
          urgency: parsed.urgency || "Medium",
        },
      });
    } catch (err) {
      console.warn("[Diagnosis] Gemini failed, using fallback. Error:", err.message);
      try {
        fs.writeFileSync("gemini_error.log", `Error: ${err.message}\nStack: ${err.stack}\n`);
      } catch (logErr) {
        console.error("Failed to write error log:", logErr.message);
      }
    }
  }


  // ── 2. Instant keyword fallback (always works) ─────────────────────────────
  const fallback = getFallbackDiagnosis(issue);
  console.log("[Diagnosis] Fallback result:", fallback);

  return res.json({
    success: true,
    source: "fallback",
    diagnosis: fallback,
  });
});

export default router;