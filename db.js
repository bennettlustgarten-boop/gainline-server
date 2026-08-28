// ---------------------------------------------------------------------------
// Very small JSON-file "database" — good enough to get the Stripe flow working
// end to end, but NOT what you should ship to production.
//
// Before going live, swap this out for a real database (Postgres, SQLite,
// MongoDB — whatever you're comfortable with) and keep the same function
// names (getCoach, saveCoach, etc.) so the rest of the code doesn't change.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data.json");

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { coaches: {}, payments: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getCoach(coachId) {
  const db = readDb();
  return db.coaches[coachId] || null;
}

function saveCoach(coachId, data) {
  const db = readDb();
  db.coaches[coachId] = { ...db.coaches[coachId], ...data };
  writeDb(db);
  return db.coaches[coachId];
}

function findCoachByStripeAccountId(stripeAccountId) {
  const db = readDb();
  return Object.entries(db.coaches).find(
    ([, c]) => c.stripeAccountId === stripeAccountId
  );
}

function recordPayment(payment) {
  const db = readDb();
  db.payments.push({ ...payment, createdAt: Date.now() });
  writeDb(db);
}

module.exports = { getCoach, saveCoach, findCoachByStripeAccountId, recordPayment };
