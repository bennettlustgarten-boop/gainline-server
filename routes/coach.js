const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { getCoach, saveCoach } = require("../db");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:5173";

// Step 1 — start onboarding for a coach.
// coachId here should be your app's own internal ID for that coach.
router.post("/onboard", async (req, res) => {
  try {
    const { coachId, email } = req.body;
    if (!coachId) return res.status(400).json({ error: "coachId is required" });

    let coach = getCoach(coachId);

    // Create the Stripe connected account once, reuse it after that.
    if (!coach?.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      coach = saveCoach(coachId, {
        stripeAccountId: account.id,
        onboardingComplete: false,
      });
    }

    // Generate a one-time onboarding link — Stripe hosts this page.
    // The coach enters their own bank details directly with Stripe; your
    // server and database never see or store that information.
    const accountLink = await stripe.accountLinks.create({
      account: coach.stripeAccountId,
      refresh_url: `${APP_URL}/onboarding/refresh?coachId=${coachId}`,
      return_url: `${APP_URL}/onboarding/complete?coachId=${coachId}`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Check whether a coach has finished onboarding and can receive payouts.
router.get("/status/:coachId", async (req, res) => {
  try {
    const coach = getCoach(req.params.coachId);
    if (!coach?.stripeAccountId) {
      return res.json({ onboarded: false });
    }
    const account = await stripe.accounts.retrieve(coach.stripeAccountId);
    const onboarded = account.charges_enabled && account.payouts_enabled;
    saveCoach(req.params.coachId, { onboardingComplete: onboarded });
    res.json({ onboarded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
