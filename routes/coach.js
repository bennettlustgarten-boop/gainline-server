const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { saveUser, listOnboardedCoaches } = require("../db");
const { requireRole } = require("../middleware/auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:4242";

// Start (or resume) Stripe Connect payout onboarding for the logged-in coach.
router.post("/onboard", requireRole("coach"), async (req, res) => {
  try {
    let coach = req.user;

    if (!coach.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: coach.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      coach = saveUser(coach.id, { stripeAccountId: account.id, onboardingComplete: false });
    }

    const accountLink = await stripe.accountLinks.create({
      account: coach.stripeAccountId,
      refresh_url: `${APP_URL}/onboarding-refresh.html`,
      return_url: `${APP_URL}/onboarding-complete.html`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Check whether the logged-in coach has finished onboarding and can be paid.
router.get("/status", requireRole("coach"), async (req, res) => {
  try {
    if (!req.user.stripeAccountId) return res.json({ onboarded: false });
    const account = await stripe.accounts.retrieve(req.user.stripeAccountId);
    const onboarded = account.charges_enabled && account.payouts_enabled;
    saveUser(req.user.id, { onboardingComplete: onboarded });
    res.json({ onboarded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Public list of coaches who've finished payout setup — used by the client
// "browse coaches" / pay page. Only ever exposes coachId/name, never Stripe IDs.
router.get("/list", (req, res) => {
  res.json({ coaches: listOnboardedCoaches() });
});

const CLIENT_COUNT_BANDS = ["0", "1-2", "3-5", "6-15", "16+"];

// One-time post-signup survey (client count + coaching type) shown on first
// login. Answers just inform the tier recommendation shown right after —
// nothing here gates access, so a skipped survey still marks complete.
router.post("/survey", requireRole("coach"), (req, res) => {
  const { clientCountBand, coachingType, skip } = req.body;
  const patch = { coachSurveyComplete: true };
  if (!skip) {
    if (clientCountBand && CLIENT_COUNT_BANDS.includes(clientCountBand)) patch.clientCountBand = clientCountBand;
    if (typeof coachingType === "string") patch.coachingType = coachingType.trim().slice(0, 200);
  }
  const user = saveUser(req.user.id, patch);
  res.json({ ok: true, clientCountBand: user.clientCountBand, coachingType: user.coachingType });
});

module.exports = router;
