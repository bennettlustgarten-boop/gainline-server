require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const SqliteSessionStore = require("./lib/sqliteSessionStore");

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
const webhookRoutes = require("./routes/webhooks");

const app = express();

// Needed so express-rate-limit (and req.secure/req.ip generally) sees the
// real client IP instead of the proxy's, once this runs behind Render's
// (or any) reverse proxy in production.
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));

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

// The front-end (plain HTML/CSS/JS) lives in /public and is served from the
// same origin as the API, so no CORS setup is needed between them.
// NOTE: check-in videos/photos live in /uploads/checkins, NOT here — they're
// private and only reachable through the authenticated route in
// routes/checkins.js. Ad media is intentionally public (shown to any client
// browsing "Find a Coach"), so it's served directly off disk here.
app.use("/media/ads", express.static(path.join(__dirname, "uploads", "ads")));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Gainline server listening on http://localhost:${PORT}`);
});
