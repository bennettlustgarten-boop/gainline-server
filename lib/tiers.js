// Coach membership ladder — how many clients a coach can have at each price.
// Shared by the membership checkout route and the client-cap enforcement in
// routes/relationships.js. The public/*.js dashboards keep their own copy of
// this list (no bundler in this app to share code with the browser).

const TIERS = [
  { id: "free", label: "Starter", max: 2, price: 0 },
  { id: "t40", label: "Growth", max: 5, price: 40 },
  { id: "t80", label: "Studio", max: 15, price: 80 },
  { id: "t140", label: "Unlimited", max: Infinity, price: 140 },
];

const ADS_PRICE_USD = 25;
const ADS_INTERVAL_MONTHS = 3; // billed every 3 months, not monthly

function tierForCount(n) {
  return TIERS.find((t) => n <= t.max) || TIERS[TIERS.length - 1];
}

function tierById(id) {
  return TIERS.find((t) => t.id === id) || TIERS[0];
}

// The tier that actually governs a coach's client cap — what they're paying
// for (user.membershipTier), NOT a bracket derived from their current client
// count. (tierForCount exists only for display contexts that genuinely want
// "what bracket does this number fall in," e.g. the tier ladder highlight —
// it must never be used for cap enforcement.)
function tierForCoach(coach) {
  return tierById(coach?.membershipTier || "free");
}

const UNLIMITED_TIER_ID = "t140";

// Unlimited-tier coaches get the ad listing for free, on top of unlimited
// clients — everyone else needs an active $25/quarter ad subscription.
function adsIncluded(coach) {
  return coach?.adStatus === "active" || coach?.membershipTier === UNLIMITED_TIER_ID;
}

module.exports = { TIERS, ADS_PRICE_USD, ADS_INTERVAL_MONTHS, UNLIMITED_TIER_ID, tierForCount, tierById, tierForCoach, adsIncluded };
