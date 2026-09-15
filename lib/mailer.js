// Shared Gmail SMTP transporter, used by both the "Contact support" form
// and outbound account emails (email verification). One Gmail account
// (an App Password, not the real account password — see .env.example)
// covers both. `transporter` is null until both env vars are set, so
// callers can show a clear "not configured" error instead of failing.
const nodemailer = require("nodemailer");

const SUPPORT_EMAIL_USER = process.env.SUPPORT_EMAIL_USER;
const SUPPORT_EMAIL_APP_PASSWORD = process.env.SUPPORT_EMAIL_APP_PASSWORD;

const transporter =
  SUPPORT_EMAIL_USER && SUPPORT_EMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: "gmail", auth: { user: SUPPORT_EMAIL_USER, pass: SUPPORT_EMAIL_APP_PASSWORD } })
    : null;

module.exports = { transporter, SUPPORT_EMAIL_USER };
