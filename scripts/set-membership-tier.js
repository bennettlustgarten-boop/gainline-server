// Sets a coach's membership tier directly, without going through Stripe —
// e.g. comping the App Review demo coach account onto the Unlimited tier so
// Apple's reviewer never hits the client-cap paywall while testing. Only
// touches membershipTier (which is what actually governs the client cap and
// free ad listing, see lib/tiers.js) — it does not create or cancel any
// Stripe subscription, so membershipStatus/membershipSubId are left alone.
//
//   node scripts/set-membership-tier.js <username> <free|t40|t80|t140>
//
// Uses whichever data.db DATA_DIR resolves to (production disk on Render).
const { findUserByUsername, saveUser } = require("../db");
const { tierById } = require("../lib/tiers");

const [username, tierId] = process.argv.slice(2);
const VALID_TIERS = ["free", "t40", "t80", "t140"];

if (!username || !VALID_TIERS.includes(tierId)) {
  console.error(`Usage: node scripts/set-membership-tier.js <username> <${VALID_TIERS.join("|")}>`);
  process.exit(1);
}

const user = findUserByUsername(username);
if (!user) {
  console.error(`No user found with username "${username}"`);
  process.exit(1);
}
if (user.role !== "coach") {
  console.error(`"${username}" is a ${user.role}, not a coach — membership tiers only apply to coaches.`);
  process.exit(1);
}

const before = user.membershipTier || "free";
saveUser(user.id, { membershipTier: tierId });
const tier = tierById(tierId);
console.log(`Updated ${username} (${user.name}): membershipTier ${before} -> ${tierId} (${tier.label}, ${tier.max === Infinity ? "unlimited" : tier.max} clients).`);
console.log("No Stripe subscription was created or changed.");
