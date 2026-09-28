const Stripe = require("stripe");
const { getPaymentPlans, listAllUsers } = require("../db");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Monthly client -> coach payment plans this account is on either side of:
// a client's own plans, or every plan any client has with this coach.
function activeClientPlanSubIds(user) {
  const plans =
    user.role === "coach"
      ? listAllUsers()
          .filter((u) => u.role === "client")
          .flatMap((u) => getPaymentPlans(u.id))
          .filter((p) => p.coachId === user.id)
      : getPaymentPlans(user.id);
  return plans.filter((p) => p.status === "active" && p.stripeSubscriptionId).map((p) => p.stripeSubscriptionId);
}

// Cancels every recurring Stripe charge tied to an account: a coach's
// Gainline membership and ad listing, plus any monthly client -> coach plans.
// Called before an account is deleted — deleting the users row alone left
// those subscriptions billing the card on file with no account behind them.
// Failures are logged, not thrown, so a Stripe hiccup never blocks a user
// from deleting their account.
async function cancelUserSubscriptions(user) {
  if (!user) return;
  const subIds = [user.membershipSubId, user.adSubId, ...activeClientPlanSubIds(user)].filter(Boolean);
  for (const subId of subIds) {
    await stripe.subscriptions.cancel(subId).catch((err) => console.error(`Failed to cancel subscription ${subId}:`, err.message));
  }
}

module.exports = { cancelUserSubscriptions };
