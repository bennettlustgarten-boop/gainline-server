const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { findCoachByStripeAccountId, saveCoach, recordPayment } = require("../db");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// IMPORTANT: this route needs the raw request body (not JSON-parsed) to verify
// the signature, so it's mounted with express.raw() in server.js — don't
// change that or signature verification will fail.
router.post("/stripe", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "account.updated": {
      const account = event.data.object;
      const entry = findCoachByStripeAccountId(account.id);
      if (entry) {
        const [coachId] = entry;
        saveCoach(coachId, {
          onboardingComplete: account.charges_enabled && account.payouts_enabled,
        });
      }
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object;
      recordPayment({
        stripeSessionId: session.id,
        amountTotal: session.amount_total,
        mode: session.mode,
        customerEmail: session.customer_details?.email,
      });
      break;
    }

    case "invoice.paid": {
      // A monthly subscription payment succeeded — update your own
      // billing status here (e.g. mark that client's plan as "paid").
      break;
    }

    default:
      // Plenty of other event types exist (payouts, disputes, refunds...).
      // Add cases here as your app needs to react to them.
      break;
  }

  res.json({ received: true });
});

module.exports = router;
