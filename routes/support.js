const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getUser, addSupportRequest } = require("../db");
const { uid } = require("../lib/uid");

// Anyone can hit this — logged in or not (the signup page has a support link
// before a visitor has an account) — so it's rate-limited by IP to stop spam.
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many support requests from this network. Please try again later." },
});

// No public support email anymore — that address was getting flooded by
// bots. Requests land here instead, visible only in the admin dashboard, so
// real ones can get a private reply.
router.post("/", supportLimiter, (req, res) => {
  const { message, replyTo } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });

  const sessionUser = req.session?.userId ? getUser(req.session.userId) : null;
  addSupportRequest({
    id: uid("sup_"),
    message: message.trim(),
    replyTo: replyTo?.trim() || null,
    fromUserId: sessionUser?.id || null,
    fromLabel: sessionUser ? `${sessionUser.name} (@${sessionUser.username}, ${sessionUser.role})` : "A visitor who isn't logged in",
    resolved: false,
    createdAt: Date.now(),
  });
  res.json({ ok: true });
});

module.exports = router;
