const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const {
  getUser,
  saveUser,
  findUserByUsername,
  findUserByEmail,
  findUserByEmailVerifyToken,
  findUserByPasswordResetToken,
  getInvite,
  addRelationship,
  getClientIds,
  deleteUserCascade,
} = require("../db");
const { uid } = require("../lib/uid");
const { publicUser } = require("../lib/publicUser");
const { tierForCoach } = require("../lib/tiers");
const { sendMail, configured: mailerConfigured } = require("../lib/mailer");
const { requireAuth } = require("../middleware/auth");

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = process.env.APP_URL || "http://localhost:4242";
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

// Cloudflare Turnstile CAPTCHA on signup, added after a bot created dozens of
// fake accounts. Skipped entirely when TURNSTILE_SECRET_KEY isn't set (e.g.
// local dev) so that's never required to run the app locally — only
// production needs the real key.
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: ip || "" }),
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error("Turnstile verification request failed:", err.message);
    return false;
  }
}

async function sendVerificationEmail(user) {
  if (!mailerConfigured || !user.email) return;
  const link = `${APP_URL}/verify-email.html?token=${user.emailVerifyToken}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Verify your Gainline email",
      text: `Hi ${user.name},\n\nClick the link below to verify your email and activate your Gainline account:\n\n${link}\n\nThis link expires in 24 hours. If you didn't sign up for Gainline, you can ignore this email.`,
    });
  } catch (err) {
    console.error("Failed to send verification email:", err.message);
  }
}

async function sendPasswordResetEmail(user) {
  if (!mailerConfigured || !user.email) return;
  const link = `${APP_URL}/reset-password.html?token=${user.passwordResetToken}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your Gainline password",
      text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your Gainline password. Click the link below to choose a new one:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.`,
    });
  } catch (err) {
    console.error("Failed to send password reset email:", err.message);
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
    const { role, name, username, email, password, inviteToken, turnstileToken } = req.body;
    if (!["coach", "client"].includes(role)) return res.status(400).json({ error: "role must be coach or client" });
    if (!name?.trim() || !username?.trim() || !password || !email?.trim()) {
      return res.status(400).json({ error: "name, username, email, and password are required" });
    }
    if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "Enter a valid email address" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (!(await verifyTurnstile(turnstileToken, req.ip))) {
      return res.status(400).json({ error: "Verification check failed — please try again." });
    }

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

// Self-service account deletion — required for App Store review (Apple
// guideline 5.1.1(v): any app that supports account creation must let a
// user delete their account from inside the app, not just deactivate it).
// Requires the current password as confirmation, same as changing a
// password, since this is permanent and irreversible.
router.delete("/me", requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Enter your password to confirm account deletion" });

  const ok = await bcrypt.compare(password, req.user.passwordHash || "");
  if (!ok) return res.status(401).json({ error: "Incorrect password" });

  deleteUserCascade(req.user.id);
  req.session.destroy(() => res.json({ ok: true }));
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
  if (!mailerConfigured) {
    return res.status(500).json({ error: "Email sending isn't configured yet — set RESEND_API_KEY in .env." });
  }

  const user = saveUser(req.user.id, { emailVerifyToken: uid("evt_"), emailVerifyTokenExpires: Date.now() + VERIFY_TOKEN_TTL_MS });
  await sendVerificationEmail(user);
  res.json({ ok: true });
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a while and try again." },
});

router.post("/verify-email", tokenLimiter, async (req, res) => {
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

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests from this network. Please wait a while and try again." },
});

// Always responds the same way whether or not the email is on file —
// otherwise this endpoint would let anyone check which emails have an
// account here just by watching which responses differ.
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: "email is required" });

  const user = findUserByEmail(email.trim());
  if (user) {
    const updated = saveUser(user.id, {
      passwordResetToken: uid("prt_"),
      passwordResetTokenExpires: Date.now() + RESET_TOKEN_TTL_MS,
    });
    await sendPasswordResetEmail(updated);
  }
  res.json({ ok: true });
});

router.post("/reset-password", tokenLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const user = findUserByPasswordResetToken(token);
  if (!user) return res.status(400).json({ error: "That reset link is invalid or has already been used." });
  if (user.passwordResetTokenExpires && user.passwordResetTokenExpires < Date.now()) {
    return res.status(400).json({ error: "That reset link has expired — request a new one." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  saveUser(user.id, { passwordHash, passwordResetToken: null, passwordResetTokenExpires: null });
  res.json({ ok: true });
});

module.exports = router;
