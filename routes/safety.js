const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const {
  getUser, addSupportRequest, getMessages, listAds, getReviews,
  addBlock, removeBlock, getBlockedIds, getCoachIdForClient, removeRelationship,
} = require("../db");
const { uid } = require("../lib/uid");
const { requireVerified } = require("../middleware/auth");

// Reporting and blocking — App Store guideline 1.2 requires both for any app
// where users see content from other users (messages, coach ads, reviews).
// Reports land in the admin dashboard's inbox alongside support requests.

const REPORT_TYPES = ["message", "ad", "review", "user"];
const MAX_REASON_LENGTH = 500;

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: "You've sent a lot of reports — please wait a while before sending more." },
});

// Looks up the content being reported server-side, so the report carries the
// real text as evidence rather than whatever the reporter's browser claims.
function excerptFor(type, reporter, target, refId) {
  if (type === "message") {
    const msg = getMessages(reporter.id, target.id).find((m) => m.id === refId && m.from === target.id);
    return msg ? msg.text : null;
  }
  if (type === "ad") {
    const ad = listAds().find((a) => a.coachId === target.id);
    return ad ? ad.caption : null;
  }
  if (type === "review") return null; // handled in the route, where the coach id is known
  return null;
}

router.post("/report", requireVerified, reportLimiter, (req, res) => {
  const { type, coachId, refId, reason } = req.body;
  let { targetUserId } = req.body;
  if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: "Invalid report type" });
  // Public reviews don't expose their author's id, so a review is reported by
  // the coach it's on plus the review id, and the author is resolved here.
  let reportedReview = null;
  if (type === "review") {
    reportedReview = getReviews(coachId).find((r) => r.id === refId) || null;
    if (!reportedReview) return res.status(404).json({ error: "That review no longer exists" });
    targetUserId = reportedReview.clientId;
  }
  const target = getUser(targetUserId);
  if (!target) return res.status(404).json({ error: "That user no longer exists" });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't report yourself" });
  const cleanReason = String(reason || "").trim().slice(0, MAX_REASON_LENGTH);
  if (!cleanReason) return res.status(400).json({ error: "Please tell us what's wrong" });

  const excerpt = type === "review" ? reportedReview.comment : excerptFor(type, req.user, target, refId);
  addSupportRequest({
    id: uid("sup_"),
    kind: "report",
    reportType: type,
    reportedUserId: target.id,
    message: [
      `REPORT (${type}) against ${target.name} (@${target.username}, ${target.role}, ${target.id})`,
      `Reason: ${cleanReason}`,
      excerpt ? `Reported content: "${String(excerpt).slice(0, 1000)}"` : null,
    ].filter(Boolean).join("\n"),
    replyTo: req.user.email || null,
    fromUserId: req.user.id,
    fromLabel: `${req.user.name} (@${req.user.username}, ${req.user.role})`,
    resolved: false,
    createdAt: Date.now(),
  });
  res.json({ ok: true });
});

// Blocking also ends any existing coach<->client connection between the two,
// so a blocked user can't keep receiving sheets or check-ins either.
router.post("/block", requireVerified, (req, res) => {
  const { userId } = req.body;
  const target = getUser(userId);
  if (!target) return res.status(404).json({ error: "That user no longer exists" });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't block yourself" });

  addBlock(req.user.id, target.id);
  if (req.user.role === "client" && getCoachIdForClient(req.user.id) === target.id) {
    removeRelationship(target.id, req.user.id);
  } else if (req.user.role === "coach" && target.role === "client" && getCoachIdForClient(target.id) === req.user.id) {
    removeRelationship(req.user.id, target.id);
  }
  res.json({ ok: true });
});

router.delete("/block/:userId", requireVerified, (req, res) => {
  removeBlock(req.user.id, req.params.userId);
  res.json({ ok: true });
});

router.get("/blocked", requireVerified, (req, res) => {
  const blocked = getBlockedIds(req.user.id)
    .map((id) => getUser(id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role }));
  res.json({ blocked });
});

module.exports = router;
