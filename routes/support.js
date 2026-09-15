const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getUser } = require("../db");
const { sendMail, configured } = require("../lib/mailer");

// Resend's sandbox mode (no verified domain yet) only allows sending to the
// exact-case address that owns the API key — lowercase matches that.
const SUPPORT_TO = "gainlinesupport@gmail.com";

// Anyone can hit this — logged in or not (the signup page has a support link
// before a visitor has an account) — so it's rate-limited by IP to stop spam.
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many support requests from this network. Please try again later, or email us directly." },
});

router.post("/", supportLimiter, async (req, res) => {
  try {
    if (!configured) {
      return res.status(500).json({ error: "Support email isn't configured yet — set RESEND_API_KEY in .env." });
    }
    const { message, replyTo } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "message is required" });

    const sessionUser = req.session?.userId ? getUser(req.session.userId) : null;
    const fromLabel = sessionUser
      ? `${sessionUser.name} (@${sessionUser.username}, ${sessionUser.role})`
      : "A visitor who isn't logged in";

    await sendMail({
      to: SUPPORT_TO,
      replyTo: replyTo?.trim() || undefined,
      subject: `Gainline support request from ${sessionUser ? sessionUser.name : "a visitor"}`,
      text: `${message.trim()}\n\n— ${fromLabel}${replyTo?.trim() ? `\nReply-to: ${replyTo.trim()}` : ""}`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong sending that — try emailing us directly instead." });
  }
});

module.exports = router;
