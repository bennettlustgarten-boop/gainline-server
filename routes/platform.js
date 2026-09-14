const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { saveUser } = require("../db");
const { TIERS, ADS_PRICE_USD, ADS_INTERVAL_MONTHS, UNLIMITED_TIER_ID, tierById, adsIncluded } = require("../lib/tiers");
const { requireRole } = require("../middleware/auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:4242";

// These are subscriptions on the PLATFORM's own Stripe account (no Connect,
// no transfer_data) — this is money coaches pay Gainline directly, separate
// from the client -> coach Connect payments in routes/payments.js.

async function getOrCreateCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  saveUser(user.id, { stripeCustomerId: customer.id });
  return customer.id;
}

// Webhooks are the source of truth in production, but they need a public URL
// (or `stripe listen` locally) to be delivered at all. As a fallback for
// local testing without that set up, re-check any pending subscription
// directly against Stripe whenever the status is loaded.
async function reconcileSubscription(user, subIdField, statusField, tierField) {
  const subId = user[subIdField];
  if (!subId || user[statusField] === "active") return user;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const active = sub.status === "active" || sub.status === "trialing";
    const patch = { [statusField]: active ? "active" : sub.status };
    if (!active && tierField) patch[tierField] = "free";
    return saveUser(user.id, patch);
  } catch {
    return user;
  }
}

router.get("/status", requireRole("coach"), async (req, res) => {
  let user = req.user;
  user = await reconcileSubscription(user, "membershipSubId", "membershipStatus", "membershipTier");
  user = await reconcileSubscription(user, "adSubId", "adStatus", null);

  res.json({
    tiers: TIERS.map((t) => ({ ...t, max: t.max === Infinity ? null : t.max })),
    adsPriceUsd: ADS_PRICE_USD,
    adsIntervalMonths: ADS_INTERVAL_MONTHS,
    membershipTier: user.membershipTier || "free",
    membershipStatus: user.membershipStatus || null,
    adStatus: user.adStatus || null,
    adsFreeWithTier: user.membershipTier === UNLIMITED_TIER_ID,
    adsIncluded: adsIncluded(user),
  });
});

// Webhooks are the authoritative way this gets set in production, but they
// require a public URL (or `stripe listen`) to be delivered locally. As a
// fast-path fallback, the success redirect carries the session id and the
// dashboard calls this once so the UI reflects the new subscription
// immediately even with no webhook delivery.
router.post("/confirm", requireRole("coach"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== req.user.id) return res.status(403).json({ error: "Not your checkout session" });
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return res.json({ ok: true, pending: true });
    }

    if (session.metadata.purpose === "membership") {
      saveUser(req.user.id, { membershipTier: session.metadata.tierId, membershipStatus: "active", membershipSubId: session.subscription });
    } else if (session.metadata.purpose === "ads") {
      saveUser(req.user.id, { adStatus: "active", adSubId: session.subscription });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/membership/checkout", requireRole("coach"), async (req, res) => {
  try {
    const { tierId } = req.body;
    const tier = tierById(tierId);
    if (!tier || tier.id === "free") {
      // Downgrading to free just cancels whatever paid subscription exists.
      if (req.user.membershipSubId) {
        await stripe.subscriptions.cancel(req.user.membershipSubId).catch(() => {});
      }
      saveUser(req.user.id, { membershipTier: "free", membershipStatus: null, membershipSubId: null });
      return res.json({ ok: true });
    }

    const customerId = await getOrCreateCustomer(req.user);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(tier.price * 100),
            recurring: { interval: "month" },
            product_data: { name: `Gainline membership — ${tier.label}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/coach-dashboard.html?tab=membership&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/coach-dashboard.html?tab=membership&checkout=cancelled`,
      metadata: { purpose: "membership", userId: req.user.id, tierId: tier.id },
      subscription_data: { metadata: { purpose: "membership", userId: req.user.id, tierId: tier.id } },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/ads/checkout", requireRole("coach"), async (req, res) => {
  try {
    if (req.user.membershipTier === UNLIMITED_TIER_ID) {
      return res.status(400).json({ error: "Advertising is already included free with your Unlimited plan" });
    }
    if (req.user.adStatus === "active") return res.status(400).json({ error: "Your ad subscription is already active" });

    const customerId = await getOrCreateCustomer(req.user);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(ADS_PRICE_USD * 100),
            recurring: { interval: "month", interval_count: ADS_INTERVAL_MONTHS },
            product_data: { name: "Gainline — Find a Coach feed listing" },
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/coach-dashboard.html?tab=ads&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/coach-dashboard.html?tab=ads&checkout=cancelled`,
      metadata: { purpose: "ads", userId: req.user.id },
      subscription_data: { metadata: { purpose: "ads", userId: req.user.id } },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/ads/cancel", requireRole("coach"), async (req, res) => {
  try {
    if (req.user.adSubId) {
      await stripe.subscriptions.cancel(req.user.adSubId).catch(() => {});
    }
    saveUser(req.user.id, { adStatus: null, adSubId: null });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
