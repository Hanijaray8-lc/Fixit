import express from "express";
import axios from "axios";
import Worker from "../models/Worker.js";

const router = express.Router();

// ── In-memory rate limiter (stay under Groq's 30 RPM free tier) ──
const REQUEST_TIMESTAMPS = [];
const MAX_REQUESTS_PER_MINUTE = 28;

const isRateLimited = () => {
  const now = Date.now();
  while (REQUEST_TIMESTAMPS.length > 0 && now - REQUEST_TIMESTAMPS[0] > 60000) {
    REQUEST_TIMESTAMPS.shift();
  }
  return REQUEST_TIMESTAMPS.length >= MAX_REQUESTS_PER_MINUTE;
};

const recordRequest = () => {
  REQUEST_TIMESTAMPS.push(Date.now());
};

const getSecondsUntilSlotAvailable = () => {
  if (REQUEST_TIMESTAMPS.length === 0) return 0;
  const oldest = REQUEST_TIMESTAMPS[0];
  const elapsed = Date.now() - oldest;
  return Math.ceil((60000 - elapsed) / 1000);
};

router.post("/", async (req, res) => {
  try {
    const { message, history = [], currentService } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required." });
    }

    const API_KEY = process.env.CHATBOT_GROQ_KEY;
    if (!API_KEY || API_KEY === "YOUR_GROQ_API_KEY_HERE") {
      return res.status(500).json({ reply: "Groq API key is not configured on the server." });
    }

    // ── Check rate limit BEFORE calling API ──
    if (isRateLimited()) {
      const waitSecs = getSecondsUntilSlotAvailable();
      return res.status(429).json({
        reply: `Too many requests! Please wait ${waitSecs} seconds and try again. 😊`
      });
    }

    // Context Injection based on keywords and current Service page context
    const lowerMessage = message.toLowerCase();

    let detectedService = currentService || "";
    if (!detectedService) {
      if (lowerMessage.includes("electric") || lowerMessage.includes("wiring") || lowerMessage.includes("fan") || lowerMessage.includes("light") || lowerMessage.includes("switch")) {
        detectedService = "Electrical Repair";
      } else if (lowerMessage.includes("plumb") || lowerMessage.includes("leak") || lowerMessage.includes("pipe") || lowerMessage.includes("tap") || lowerMessage.includes("basin")) {
        detectedService = "Plumbing";
      } else if (lowerMessage.includes("cleaning") || lowerMessage.includes("clean") || lowerMessage.includes("wash") || lowerMessage.includes("dust") || lowerMessage.includes("sweep")) {
        detectedService = "Home Cleaning";
      } else if (lowerMessage.includes("ac ") || lowerMessage.includes("air cond") || lowerMessage.includes("cool") || lowerMessage.includes("filter")) {
        detectedService = "AC Service";
      } else if (lowerMessage.includes("pest") || lowerMessage.includes("termite") || lowerMessage.includes("bug") || lowerMessage.includes("cockroach") || lowerMessage.includes("mosquito")) {
        detectedService = "Pest Control";
      } else if (lowerMessage.includes("carpenter") || lowerMessage.includes("wood") || lowerMessage.includes("door") || lowerMessage.includes("table") || lowerMessage.includes("furniture") || lowerMessage.includes("sofa")) {
        detectedService = "Carpentry";
      }
    }

    let injectedContext = "";

    if (detectedService) {
      const realWorkers = await Worker.find({
        service: { $regex: new RegExp(detectedService, "i") },
        status: { $in: ["Approved", "Active", "approved", "active"] }
      }).limit(5).select("name rating completedTasks experience service minPrice maxPrice");

      if (realWorkers && realWorkers.length > 0) {
        injectedContext += `\n[CONTEXT INJECTION - Real Active Workers for ${detectedService}]:`;
        realWorkers.forEach(w => {
          injectedContext += `\n- Name: ${w.name}, Rating: ${w.rating || 'N/A'}, Jobs Completed: ${w.completedTasks || 0}, Experience: ${w.experience || 'N/A'}, Base Price Range: ₹${w.minPrice || 0} - ₹${w.maxPrice || 'N/A'}.`;
        });
      } else {
        injectedContext += `\n[CONTEXT INJECTION - No Workers Found]: There are currently no active workers registered for the "${detectedService}" service category in the database. Instruct the user about this honestly rather than inventing worker names. Recommend checking back later or browsing other services.`;
      }
    }

    const systemPrompt = `You are the official AI Assistant strictly for the "FixIt" home service booking app. 
You MUST NOT answer unrelated questions (e.g., coding, politics, general knowledge, math, science). 
If the user asks an unrelated question, reply EXACTLY with: "I can only help you with FixIt services, workers, and bookings."
Keep your responses short, professional, helpful, and in a friendly tone. Use emojis where appropriate.
Provide estimated prices or worker details based ONLY on the context provided.
CRITICAL: Do NOT invent or make up names of workers. Only recommend workers that are explicitly listed in the [CONTEXT INJECTION] section above. If no workers are listed in the context, inform the user that no active professionals are registered under this service category right now.
${injectedContext}`;

    // Format conversation for Groq (OpenAI-compatible format)
    const messages = [
      { role: "system", content: systemPrompt }
    ];

    // Add conversation history
    history.forEach(msg => {
      messages.push({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text
      });
    });

    // Add current user message
    messages.push({ role: "user", content: message });

    // Record request in rate limiter
    recordRequest();

    // Call Groq API (OpenAI-compatible)
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        timeout: 30000
      }
    );

    const replyText = response.data?.choices?.[0]?.message?.content || "I'm having trouble connecting right now.";

    res.json({ reply: replyText });

  } catch (error) {
    console.error("Chat API Error:", error?.response?.data || error.message);

    const status = error?.response?.status;
    if (status === 429) {
      res.status(429).json({ reply: "Too many requests right now! 😅 Please wait a moment and try again." });
    } else {
      res.status(500).json({ reply: "I'm currently offline or experiencing issues. Please try again later." });
    }
  }
});

export default router;
