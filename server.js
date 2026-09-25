require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SqliteSessionStore = require("./lib/sqliteSessionStore");
const { DATA_DIR } = require("./lib/dataDir");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const relationshipRoutes = require("./routes/relationships");
const sheetRoutes = require("./routes/sheets");
const checkinRoutes = require("./routes/checkins");
const messageRoutes = require("./routes/messages");
const adRoutes = require("./routes/ads");
const platformRoutes = require("./routes/platform");
const assistantRoutes = require("./routes/assistant");
const coachRoutes = require("./routes/coach");
const paymentRoutes = require("./routes/payments");
const calendarRoutes = require("./routes/calendar");
const reviewRoutes = require("./routes/reviews");
const noteRoutes = require("./routes/notes");
const supportRoutes = require("./routes/support");
const safetyRoutes = require("./routes/safety");
const webhookRoutes = require("./routes/webhooks");
const adminRoutes = require("./routes/admin");

const app = express();

// Needed so express-rate-limit (and req.secure/req.ip generally) sees the
// real client IP instead of the proxy's, once this runs behind Render's
// (or any) reverse proxy in production.
app.set("trust proxy", 1);

// This app's front-end (/public) and API are served from the same Express
// process, so there's no legitimate cross-origin caller to allow — no CORS
// middleware needed, and none configured. Security headers instead:
// helmet sets X-Content-Type-Options, X-Frame-Options, a restrictive CSP,
// etc. CSP allows 'unsafe-inline' for scripts/styles because every page
// here uses inline <script> blocks and inline style="" attributes rather
// than a build step — tightening that further would mean a bigger frontend
// refactor (external files + nonces), not just a config change.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // challenges.cloudflare.com is Cloudflare Turnstile (the signup-page
        // CAPTCHA) — it needs to load its script, render in an iframe, and
        // call back to its own domain.
        scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "https://challenges.cloudflare.com"],
        frameSrc: ["https://challenges.cloudflare.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

// The Stripe webhook route needs the RAW body to verify signatures, so it's
// mounted before express.json() and given its own raw parser.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
app.use("/api/webhooks", webhookRoutes);

// Everything else can use normal JSON parsing.
app.use(express.json());

// Every /api response carries per-session data (who's logged in, their
// clients, messages, etc.), so none of it may ever be cached. Without this,
// GET requests like /api/auth/me had no cache header at all — browsers were
// found to replay a stale cached 200 (from while still logged in) on a
// history back/forward navigation instead of hitting the network, so a
// logged-out user hitting Back could land back on a dashboard that still
// looked fully logged in. This is the actual fix for that; the no-store
// header on the dashboard HTML pages below is defense-in-depth on top of it.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto" only marks the cookie Secure when the request actually came in
      // over HTTPS (respecting "trust proxy" above) — stays usable on
      // localhost http:// in dev, and locks it down once deployed.
      secure: "auto",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api", relationshipRoutes); // /api/clients, /api/invites
app.use("/api/sheets", sheetRoutes);
app.use("/api/checkins", checkinRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/ads", adRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/coach", coachRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/safety", safetyRoutes);
app.use("/api/admin", adminRoutes);

// The front-end (plain HTML/CSS/JS) lives in /public, served from here too.
// NOTE: check-in videos/photos live in /uploads/checkins, NOT here — they're
// private and only reachable through the authenticated route in
// routes/checkins.js. Ad media is intentionally public (shown to any client
// browsing "Find a Coach"), so it's served directly off disk here.
app.use("/media/ads", express.static(path.join(DATA_DIR, "uploads", "ads")));

// The dashboards are gated client-side by requireLogin() in app.js (it
// redirects to /login.html when there's no session), but without this header
// the browser can still serve a *cached* copy straight from bfcache/disk
// cache after logout — e.g. hitting Back and seeing the previous session's
// page instantly, data and all, with no fetch (and no requireLogin check)
// ever happening. no-store forces a real reload every time, which also
// disables bfcache for these pages in every major browser.
app.use(["/coach-dashboard.html", "/client-dashboard.html", "/admin-dashboard.html"], (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Gainline server listening on http://localhost:${PORT}`);
});
