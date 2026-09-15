const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { getUser, saveUser, findUserByUsername, findUserByEmailVerifyToken, getInvite, addRelationship, getClientIds } = require("../db");
const { uid } = require("../lib/uid");
const { publicUser } = require("../lib/publicUser");
const { tierForCoach } = require("../lib/tiers");
const { transporter, SUPPORT_EMAIL_USER } = require("../lib/mailer");
const { requireAuth } = require("../middleware/auth");

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = process.env.APP_URL || "http://localhost:4242";
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

async function sendVerificationEmail(user) {
  if (!transporter || !user.email) return;
  const link = `${APP_URL}/verify-email.html?token=${user.emailVerifyToken}`;
  try {
    await transporter.sendMail({
      from: SUPPORT_EMAIL_USER,
      to: user.email,
      subject: "Verify your Gainline email",
      text: `Hi ${user.name},\n\nClick the link below to verify your email and activate your Gainline account:\n\n${link}\n\nThis link expires in 24 hours. If you didn't sign up for Gainline, you can ignore this email.`,
    });
  } catch (err) {
    console.error("Failed to send verification email:", err.message);
  }
}

// Brute-force protection: caps how many login/signup attempts one IP can
// make in a window. Login is scored only on failed attempts so a legit user
// re-checking their session isn't penalized; signup is capped to stop
// automated mass account creation.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this network. Please try again later." },
});

router.post("/signup", signupLimiter, async (req, res) => {
  try {
    const { role, name, username, email, password, inviteToken } = req.body;
    if (!["coach", "client"].includes(role)) return res.status(400).json({ error: "role must be coach or client" });
    if (!name?.trim() || !username?.trim() || !password || !email?.trim()) {
      return res.status(400).json({ error: "name, username, email, and password are required" });
    }
    if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "Enter a valid email address" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const handle = username.trim().replace(/^@/, "").toLowerCase();
    if (!USERNAME_RE.test(handle)) {
      return res.status(400).json({ error: "Usernames are 3-20 characters: letters, numbers, underscores, or periods." });
    }
    if (findUserByUsername(handle)) {
      return res.status(400).json({ error: "That username is already taken — try another." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uid(role === "coach" ? "coach_" : "client_");
    const user = saveUser(id, {
      id,
      role,
      name: name.trim(),
      username: handle,
      email: email.trim(),
      passwordHash,
      bio: role === "coach" ? "New coach on Gainline." : "",
      createdAt: Date.now(),
      membershipTier: role === "coach" ? "free" : undefined,
      emailVerified: false,
      emailVerifyToken: uid("evt_"),
      emailVerifyTokenExpires: Date.now() + VERIFY_TOKEN_TTL_MS,
    });
    sendVerificationEmail(user);

    let inviteNotice = null;
    if (inviteToken && role === "client") {
      const invite = getInvite(inviteToken);
      if (invite) {
        const currentCount = getClientIds(invite.coachId).length;
        const inviteCoach = getUser(invite.coachId);
        const tier = tierForCoach(inviteCoach);
        if (currentCount < tier.max) {
          addRelationship(invite.coachId, id);
          inviteNotice = `You're now connected with ${inviteCoach?.name || "your coach"}!`;
        } else {
          inviteNotice = `${inviteCoach?.name || "That coach"} is fully booked right now — reach out to them directly.`;
        }
      }
    }

    req.session.userId = id;
    res.json({ user: publicUser(user), inviteNotice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong creating your account" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username and password are required" });

    const user = findUserByUsername(username.trim().replace(/^@/, ""));
    if (!user) return res.status(401).json({ error: "Invalid username or password" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid username or password" });

    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong logging in" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", requireAuth, (req, res) => {
  // /me is the one place a user's own email is safe to include — every
  // other place publicUser() is used, the subject could be someone ELSE
  // looking at a profile, where email must stay private.
  res.json({ user: { ...publicUser(req.user), email: req.user.email || null } });
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification emails requested. Please wait a while and try again." },
});

router.post("/resend-verification", requireAuth, verifyLimiter, async (req, res) => {
  if (req.user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  if (!req.user.email) return res.status(400).json({ error: "No email on file for this account" });
  if (!transporter) {
    return res.status(500).json({ error: "Email sending isn't configured yet — set SUPPORT_EMAIL_USER and SUPPORT_EMAIL_APP_PASSWORD in .env." });
  }

  const user = saveUser(req.user.id, { emailVerifyToken: uid("evt_"), emailVerifyTokenExpires: Date.now() + VERIFY_TOKEN_TTL_MS });
  await sendVerificationEmail(user);
  res.json({ ok: true });
});

router.post("/verify-email", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  const user = findUserByEmailVerifyToken(token);
  if (!user) return res.status(400).json({ error: "That verification link is invalid or has already been used." });
  if (user.emailVerifyTokenExpires && user.emailVerifyTokenExpires < Date.now()) {
    return res.status(400).json({ error: "That verification link has expired — request a new one from your dashboard." });
  }

  saveUser(user.id, { emailVerified: true, emailVerifyToken: null, emailVerifyTokenExpires: null });
  res.json({ ok: true });
});

module.exports = router;
