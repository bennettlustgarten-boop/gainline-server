const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getUser, getMessages, addMessage, getCoachIdForClient, getClientIds, isBlockedEitherWay } = require("../db");
const { uid } = require("../lib/uid");
const { requireVerified } = require("../middleware/auth");

// Keyed by account, not IP — this runs after requireVerified so req.user is
// always set, and per-account is the right scope here (an IP-based limit
// would unfairly throttle everyone behind the same office/campus network).
// Without this, a single verified account had no cap at all on how many
// messages it could fire at another user.
const sendLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: "You're sending messages too fast — please slow down." },
});

// A coach can message any of their own clients or any other coach.
// A client can message only their own coach.
function canMessage(me, otherId) {
  const other = getUser(otherId);
  if (!other) return false;
  if (isBlockedEitherWay(me.id, otherId)) return false;
  if (me.role === "client") {
    return getCoachIdForClient(me.id) === otherId;
  }
  // coach
  if (other.role === "coach") return true;
  return getClientIds(me.id).includes(otherId);
}

router.get("/:otherUserId", requireVerified, (req, res) => {
  const { otherUserId } = req.params;
  if (!canMessage(req.user, otherUserId)) return res.status(403).json({ error: "Not allowed" });
  res.json({ messages: getMessages(req.user.id, otherUserId) });
});

router.post("/:otherUserId", requireVerified, sendLimiter, (req, res) => {
  const { otherUserId } = req.params;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  if (!canMessage(req.user, otherUserId)) return res.status(403).json({ error: "Not allowed" });

  const message = { id: uid("m_"), from: req.user.id, text: text.trim(), at: Date.now() };
  res.json({ messages: addMessage(req.user.id, otherUserId, message) });
});

module.exports = router;
