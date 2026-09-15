const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { findUserByStripeAccountId, findUserBySubscriptionId, saveUser, recordPayment, updatePaymentPlan } = require("../db");

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
      const entry = findUserByStripeAccountId(account.id);
      if (entry) {
        const [userId] = entry;
        saveUser(userId, { onboardingComplete: account.charges_enabled && account.payouts_enabled });
      }
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object;
      const purpose = session.metadata?.purpose;

      if (purpose === "membership") {
        saveUser(session.metadata.userId, {
          membershipTier: session.metadata.tierId,
          membershipStatus: "active",
          membershipSubId: session.subscription,
          hasUsedTrial: true,
        });
      } else if (purpose === "ads") {
        saveUser(session.metadata.userId, { adStatus: "active", adSubId: session.subscription });
      } else {
        // Client -> coach one-time or first subscription payment.
        recordPayment({
          stripeSessionId: session.id,
          amountTotal: session.amount_total,
          mode: session.mode,
          coachId: session.metadata?.coachId,
          clientId: session.metadata?.clientId,
          customerEmail: session.customer_details?.email,
        });
        if (session.metadata?.planId && session.metadata?.clientId) {
          updatePaymentPlan(session.metadata.clientId, session.metadata.planId, {
            status: session.mode === "subscription" ? "active" : "paid",
            paidAt: Date.now(),
            stripeSubscriptionId: session.subscription || undefined,
          });
        }
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const purpose = subscription.metadata?.purpose;
      const active = subscription.status === "active" || subscription.status === "trialing";

      if (purpose === "membership") {
        const entry = findUserBySubscriptionId(subscription.id, "membershipSubId");
        if (entry) {
          const [userId] = entry;
          saveUser(userId, {
            membershipStatus: active ? "active" : subscription.status,
            ...(event.type === "customer.subscription.deleted" ? { membershipTier: "free", membershipSubId: null } : {}),
          });
        }
      } else if (purpose === "ads") {
        const entry = findUserBySubscriptionId(subscription.id, "adSubId");
        if (entry) {
          const [userId] = entry;
          saveUser(userId, {
            adStatus: active ? "active" : null,
            ...(event.type === "customer.subscription.deleted" ? { adSubId: null } : {}),
          });
        }
      }
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
