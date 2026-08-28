const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { getCoach } = require("../db");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);

// Create a checkout session for a client paying a coach.
// mode: "payment" for a one-time / prepaid charge, "subscription" for monthly billing.
router.post("/checkout", async (req, res) => {
  try {
    const { coachId, amountUsd, mode, description } = req.body;
    if (!coachId || !amountUsd || !mode) {
      return res.status(400).json({ error: "coachId, amountUsd, and mode are required" });
    }

    const coach = getCoach(coachId);
    if (!coach?.stripeAccountId || !coach.onboardingComplete) {
      return res.status(400).json({ error: "This coach hasn't finished payout setup yet" });
    }

    const amountCents = Math.round(Number(amountUsd) * 100);
    const applicationFeeCents = Math.round(amountCents * (FEE_PERCENT / 100));

    const lineItem = {
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: { name: description || "Coaching payment" },
        ...(mode === "subscription" ? { recurring: { interval: "month" } } : {}),
      },
      quantity: 1,
    };

    const session = await stripe.checkout.sessions.create({
      mode, // "payment" or "subscription"
      line_items: [lineItem],
      success_url: `${APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/payment/cancelled`,
      payment_intent_data:
        mode === "payment"
          ? {
              application_fee_amount: applicationFeeCents,
              transfer_data: { destination: coach.stripeAccountId },
            }
          : undefined,
      // Subscriptions split fees a little differently — see Stripe's docs on
      // "Connect + Subscriptions" (application_fee_percent on the subscription
      // instead of the payment intent) if you go this route for recurring billing.
      subscription_data:
        mode === "subscription"
          ? {
              application_fee_percent: FEE_PERCENT,
              transfer_data: { destination: coach.stripeAccountId },
            }
          : undefined,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
