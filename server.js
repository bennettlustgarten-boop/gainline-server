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
const webhookRoutes = require("./routes/webhooks");

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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
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

// The front-end (plain HTML/CSS/JS) lives in /public, served from here too.
// NOTE: check-in videos/photos live in /uploads/checkins, NOT here — they're
// private and only reachable through the authenticated route in
// routes/checkins.js. Ad media is intentionally public (shown to any client
// browsing "Find a Coach"), so it's served directly off disk here.
app.use("/media/ads", express.static(path.join(DATA_DIR, "uploads", "ads")));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Gainline server listening on http://localhost:${PORT}`);
});
