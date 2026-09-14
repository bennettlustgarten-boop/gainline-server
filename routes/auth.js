const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { getUser, saveUser, findUserByUsername, getInvite, addRelationship, getClientIds } = require("../db");
const { uid } = require("../lib/uid");
const { publicUser } = require("../lib/publicUser");
const { tierForCoach } = require("../lib/tiers");
const { requireAuth } = require("../middleware/auth");

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

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
    if (!name?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: "name, username, and password are required" });
    }
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
      email: email?.trim() || undefined,
      passwordHash,
      bio: role === "coach" ? "New coach on Gainline." : "",
      createdAt: Date.now(),
      membershipTier: role === "coach" ? "free" : undefined,
    });

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
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
