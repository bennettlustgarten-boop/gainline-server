const express = require("express");
const router = express.Router();
const { getUser, getCoachIdForClient, upsertReview, getReviews } = require("../db");
const { uid } = require("../lib/uid");
const { requireRole } = require("../middleware/auth");

function summarize(coachId) {
  const reviews = getReviews(coachId);
  const count = reviews.length;
  const average = count ? Math.round((reviews.reduce((a, r) => a + r.stars, 0) / count) * 10) / 10 : null;
  return { reviews, average, count };
}

// Public — reviews (and the average) are shown on a coach's profile and ad
// card to anyone browsing, not just their own clients.
router.get("/:coachId", (req, res) => {
  const { reviews, average, count } = summarize(req.params.coachId);
  res.json({
    reviews: [...reviews].sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r.id, clientName: r.clientName, stars: r.stars, comment: r.comment, createdAt: r.createdAt })),
    average,
    count,
  });
});

// The logged-in client's own existing review for a coach, if any — used to
// pre-fill the "leave a review" form when they're editing.
router.get("/:coachId/mine", requireRole("client"), (req, res) => {
  const mine = getReviews(req.params.coachId).find((r) => r.clientId === req.user.id) || null;
  res.json({ review: mine });
});

// A client can only review the coach they're currently connected to — that's
// this app's stand-in for "a coach they've actually worked with."
router.post("/", requireRole("client"), (req, res) => {
  const { coachId, stars, comment } = req.body;
  const starsNum = Math.round(Number(stars));
  if (!coachId || Number.isNaN(starsNum) || starsNum < 0 || starsNum > 5) {
    return res.status(400).json({ error: "coachId and a 0-5 star rating are required" });
  }
  if (getCoachIdForClient(req.user.id) !== coachId) {
    return res.status(403).json({ error: "You can only review a coach you've worked with" });
  }
  const coach = getUser(coachId);
  if (!coach || coach.role !== "coach") return res.status(404).json({ error: "Coach not found" });

  const review = {
    id: uid("rev_"),
    clientName: req.user.name,
    stars: starsNum,
    comment: (comment || "").trim(),
    createdAt: Date.now(),
  };
  upsertReview(coachId, req.user.id, review);
  res.json(summarize(coachId));
});

module.exports = router;
