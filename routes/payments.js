const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const {
  getUser,
  addRelationship,
  getCoachIdForClient,
  getClientIds,
  addPaymentPlan,
  getPaymentPlans,
  updatePaymentPlan,
} = require("../db");
const { tierForCoach } = require("../lib/tiers");
const { uid } = require("../lib/uid");
const { requireVerified, requireRole } = require("../middleware/auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:4242";
// Gainline's revenue comes from coach membership tiers and the ad listing fee
// (see routes/platform.js), not from a cut of client payments — coaches get
// 100% of what clients pay them by default. Set PLATFORM_FEE_PERCENT in .env
// to a value above 0 if you ever want to take a cut here too.
const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 0);

// Create a checkout session for the logged-in client paying a coach.
// mode: "payment" for a one-time / prepaid charge, "subscription" for monthly billing.
// planId is optional — set when the client is paying a plan the coach sent
// them (see /plans below), so the webhook can mark that plan paid.
router.post("/checkout", requireRole("client"), async (req, res) => {
  try {
    const { coachId, planId } = req.body;
    let { amountUsd, mode, description } = req.body;

    // When paying a coach-sent plan, the plan on file is the source of truth
    // for what's actually charged — never trust the client's own request for
    // the amount/mode here, or a tampered request could pay less than the
    // plan calls for while still flipping it to "paid".
    if (planId) {
      const plan = getPaymentPlans(req.user.id).find((p) => p.id === planId);
      if (!plan || plan.status !== "pending") {
        return res.status(400).json({ error: "This payment plan is no longer available" });
      }
      amountUsd = plan.amountUsd;
      mode = plan.mode;
      description = plan.description;
    }

    if (!coachId || !amountUsd || !mode) {
      return res.status(400).json({ error: "coachId, amountUsd, and mode are required" });
    }

    const coach = getUser(coachId);
    if (!coach || coach.role !== "coach" || !coach.stripeAccountId || !coach.onboardingComplete) {
      return res.status(400).json({ error: "This coach hasn't finished payout setup yet" });
    }

    const amountCents = Math.round(Number(amountUsd) * 100);
    const applicationFeeCents = Math.round(amountCents * (FEE_PERCENT / 100));
    const takesFee = FEE_PERCENT > 0;

    const lineItem = {
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: { name: description || "Coaching payment" },
        ...(mode === "subscription" ? { recurring: { interval: "month" } } : {}),
      },
      quantity: 1,
    };

    const baseMetadata = { purpose: "client-payment", clientId: req.user.id, coachId, ...(planId ? { planId } : {}) };

    const session = await stripe.checkout.sessions.create({
      mode, // "payment" or "subscription"
      payment_method_types: ["card"],
      line_items: [lineItem],
      success_url: `${APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/cancelled.html`,
      metadata: baseMetadata,
      payment_intent_data:
        mode === "payment"
          ? {
              ...(takesFee ? { application_fee_amount: applicationFeeCents } : {}),
              transfer_data: { destination: coach.stripeAccountId },
            }
          : undefined,
      subscription_data:
        mode === "subscription"
          ? {
              ...(takesFee ? { application_fee_percent: FEE_PERCENT } : {}),
              transfer_data: { destination: coach.stripeAccountId },
              metadata: baseMetadata,
            }
          : undefined,
    });

    // Paying a coach also connects the client to them, so they show up on
    // each other's Messages/Sheets tabs going forward — as long as the coach
    // has an open slot on their current membership tier.
    if (getCoachIdForClient(req.user.id) !== coachId) {
      const currentCount = getClientIds(coachId).length;
      if (currentCount < tierForCoach(coach).max) {
        addRelationship(coachId, req.user.id);
      }
    }

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Webhooks are the authoritative way payments get recorded in production, but
// they need a public URL (or `stripe listen`) to be delivered locally. As a
// fast-path fallback, success.html carries the session id and calls this once
// so a paid plan flips to paid/active immediately even with no webhook.
router.post("/confirm", requireRole("client"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.clientId !== req.user.id) return res.status(403).json({ error: "Not your checkout session" });
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return res.json({ ok: true, pending: true });
    }

    if (session.metadata?.planId) {
      const plan = getPaymentPlans(req.user.id).find((p) => p.id === session.metadata.planId);
      if (plan && plan.status === "pending") {
        updatePaymentPlan(req.user.id, session.metadata.planId, {
          status: session.mode === "subscription" ? "active" : "paid",
          paidAt: Date.now(),
          stripeSubscriptionId: session.subscription || undefined,
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Payment plans (coach sends a client a specific amount to pay) ----------

router.post("/plans", requireRole("coach"), (req, res) => {
  const { clientId, amountUsd, mode, description } = req.body;
  if (!clientId || !amountUsd || !["payment", "subscription"].includes(mode)) {
    return res.status(400).json({ error: "clientId, amountUsd, and mode are required" });
  }
  // Stored as-is and later fed to Stripe as unit_amount, so reject NaN,
  // negatives, and absurd values here rather than failing at checkout time.
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: "Amount must be between $0.01 and $100,000" });
  }
  if (!getClientIds(req.user.id).includes(clientId)) {
    return res.status(400).json({ error: "That's not one of your clients" });
  }
  const plan = {
    id: uid("plan_"),
    coachId: req.user.id,
    amountUsd: amount,
    mode, // "payment" (one-time) or "subscription" (monthly)
    description: (description || "").trim(),
    status: "pending", // pending -> paid (one-time) or active (subscription) | cancelled
    createdAt: Date.now(),
  };
  res.json({ plans: addPaymentPlan(clientId, plan) });
});

router.get("/plans/:clientId", requireVerified, (req, res) => {
  const { clientId } = req.params;
  const isSelf = req.user.id === clientId;
  const isTheirCoach = req.user.role === "coach" && getCoachIdForClient(clientId) === req.user.id;
  if (!isSelf && !isTheirCoach) return res.status(403).json({ error: "Not allowed" });
  res.json({ plans: getPaymentPlans(clientId) });
});

// Adjust a plan's price. A pending plan just gets its stored amount updated
// (nothing charged yet). An already-active subscription plan gets its live
// Stripe subscription price changed too, so future auto-pay charges reflect
// the new amount — proration_behavior: "none" means the client isn't charged
// or credited for the change mid-cycle, it just takes effect next renewal.
router.patch("/plans/:clientId/:planId", requireRole("coach"), async (req, res) => {
  try {
    const { clientId, planId } = req.params;
    const { amountUsd, description } = req.body;
    const newAmount = Number(amountUsd);
    if (!Number.isFinite(newAmount) || newAmount <= 0 || newAmount > 100000) {
      return res.status(400).json({ error: "Amount must be between $0.01 and $100,000" });
    }

    const plan = getPaymentPlans(clientId).find((p) => p.id === planId);
    if (!plan || plan.coachId !== req.user.id) return res.status(404).json({ error: "Plan not found" });
    if (plan.status === "paid" || plan.status === "cancelled") {
      return res.status(400).json({ error: `A ${plan.status} plan can't be edited — send a new one instead.` });
    }

    const patch = { amountUsd: newAmount, description: (description ?? plan.description ?? "").trim() };

    if (plan.status === "active" && plan.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(plan.stripeSubscriptionId);
      const item = subscription.items.data[0];
      // The Subscriptions API (unlike Checkout Sessions) won't take an inline
      // product_data — it needs an existing product id, so reuse whichever
      // product is already on this line item and just rename it.
      const productId = item.price.product;
      await stripe.products.update(productId, { name: patch.description || "Coaching payment" });
      await stripe.subscriptions.update(plan.stripeSubscriptionId, {
        items: [
          {
            id: item.id,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(patch.amountUsd * 100),
              recurring: { interval: "month" },
              product: productId,
            },
          },
        ],
        proration_behavior: "none",
      });
    }

    updatePaymentPlan(clientId, planId, patch);
    res.json({ plans: getPaymentPlans(clientId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/plans/:clientId/:planId", requireRole("coach"), (req, res) => {
  const { clientId, planId } = req.params;
  const plan = getPaymentPlans(clientId).find((p) => p.id === planId);
  if (!plan || plan.coachId !== req.user.id) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "pending") return res.status(400).json({ error: "Only a pending plan can be cancelled" });
  updatePaymentPlan(clientId, planId, { status: "cancelled" });
  res.json({ ok: true });
});

module.exports = router;
