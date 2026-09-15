const express = require("express");
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { requireRole } = require("../middleware/auth");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PLACEHOLDER_KEY = "your_anthropic_api_key_here";
const MAX_QUESTION_LENGTH = 2000;

// This hits a real, billable API, so it's rate-limited per coach (not just
// per IP — coaches share networks) to cap worst-case cost from a runaway
// client, a compromised session, or someone scripting the endpoint.
const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId || ipKeyGenerator(req.ip),
  message: { error: "You've hit the assistant's rate limit for now — try again in a few minutes." },
});

router.post("/ask", requireRole("coach"), askLimiter, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === PLACEHOLDER_KEY) {
      return res.status(500).json({ error: "The assistant isn't configured yet — set a real ANTHROPIC_API_KEY in .env." });
    }
    const { question } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "question is required" });
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Keep questions under ${MAX_QUESTION_LENGTH} characters.` });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `You are a knowledgeable fitness coaching assistant inside the Gainline app, helping a personal trainer named ${req.user.name} plan for their clients. Be concise, practical, and use bullet points where useful. Coach's question: ${question.trim()}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Anthropic API error:", response.status, errBody);
      return res.status(502).json({ error: "The assistant is unavailable right now." });
    }

    const data = await response.json();
    const text = (data.content || []).map((c) => c.text || "").join("\n") || "Sorry, I couldn't generate a response.";
    res.json({ answer: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong reaching the assistant." });
  }
});

module.exports = router;
