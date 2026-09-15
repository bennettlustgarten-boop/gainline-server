const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const { getUser } = require("../db");

const SUPPORT_TO = "GainLineSupport@gmail.com";
const SMTP_USER = process.env.SUPPORT_EMAIL_USER;
const SMTP_PASS = process.env.SUPPORT_EMAIL_APP_PASSWORD;

// Only built if both env vars are set — see .env.example for how to get a
// Gmail App Password. Until then, the route below returns a clear "not
// configured" error instead of silently failing.
const transporter =
  SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } })
    : null;

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
    if (!transporter) {
      return res.status(500).json({
        error: "Support email isn't configured yet — set SUPPORT_EMAIL_USER and SUPPORT_EMAIL_APP_PASSWORD in .env.",
      });
    }
    const { message, replyTo } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "message is required" });

    const sessionUser = req.session?.userId ? getUser(req.session.userId) : null;
    const fromLabel = sessionUser
      ? `${sessionUser.name} (@${sessionUser.username}, ${sessionUser.role})`
      : "A visitor who isn't logged in";

    await transporter.sendMail({
      from: SMTP_USER,
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
