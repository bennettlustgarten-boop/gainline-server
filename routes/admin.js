const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { getUser, saveUser, listAllUsers, getAllPayments, deleteUserCascade } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// Timing-safe comparison for secrets of any length — hash both sides to a
// fixed size first since crypto.timingSafeEqual requires equal-length
// buffers and the raw strings being compared aren't guaranteed to match.
function safeEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(String(a)).digest();
  const hashB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." },
});

router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Admin login isn't configured yet — set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) in .env." });
  }
  if (!username || !password || !safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

router.get("/stats", requireAdmin, (req, res) => {
  const users = listAllUsers();
  const coaches = users.filter((u) => u.role === "coach");
  const clients = users.filter((u) => u.role === "client");
  const payments = getAllPayments();

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const signupsIn = (ms) => users.filter((u) => now - (u.createdAt || 0) < ms).length;

  const tierCounts = {};
  for (const c of coaches) {
    const tier = c.membershipTier || "free";
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  const totalRevenueCents = payments.reduce((sum, p) => sum + (p.amountTotal || 0), 0);

  res.json({
    totalUsers: users.length,
    totalCoaches: coaches.length,
    totalClients: clients.length,
    emailVerified: users.filter((u) => u.emailVerified).length,
    emailUnverified: users.filter((u) => !u.emailVerified).length,
    signups24h: signupsIn(DAY),
    signups7d: signupsIn(7 * DAY),
    signups30d: signupsIn(30 * DAY),
    coachesOnboarded: coaches.filter((c) => c.onboardingComplete).length,
    tierCounts,
    activeMemberships: coaches.filter((c) => c.membershipStatus === "active").length,
    activeAdSubs: coaches.filter((c) => c.adStatus === "active").length,
    clientPaymentCount: payments.length,
    clientPaymentTotalUsd: Math.round((totalRevenueCents / 100) * 100) / 100,
  });
});

// Every field here is safe to show an operator except passwordHash and the
// raw verify/reset tokens — those are stripped, everything else (including
// email, since this is an admin surface, not a public one) is fair game.
function adminSafeUser(u) {
  const { passwordHash, emailVerifyToken, passwordResetToken, ...rest } = u;
  return rest;
}

router.get("/users", requireAdmin, (req, res) => {
  const users = listAllUsers()
    .map(adminSafeUser)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ users });
});

router.post("/users/:userId/reset-password", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  saveUser(userId, { passwordHash, passwordResetToken: null, passwordResetTokenExpires: null });
  res.json({ ok: true });
});

router.delete("/users/:userId", requireAdmin, (req, res) => {
  const { userId } = req.params;
  const result = deleteUserCascade(userId);
  if (!result) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true, deleted: result.deleted });
});

module.exports = router;
