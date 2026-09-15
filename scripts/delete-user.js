// Deletes a user account and everything tied to it — not just the users
// row, but their relationships, sheets, check-ins, messages, notes, payment
// plans, calendar data, reviews, ads, and pending invites too. Run with:
//
//   node scripts/delete-user.js <username> [--yes]
//
// Without --yes it only prints what it *would* delete. Works against
// whichever data.db this process resolves via DATA_DIR (see lib/dataDir.js)
// — on Render's Shell that's already set to the production disk, so no
// extra flags are needed there.
const { getCollection, getItem, setItem, deleteItem } = (() => {
  const { db } = require("../lib/sqlite");
  const getStmt = db.prepare("SELECT value FROM store WHERE collection = ? AND key = ?");
  const getAllStmt = db.prepare("SELECT key, value FROM store WHERE collection = ?");
  const setStmt = db.prepare(
    "INSERT INTO store (collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value"
  );
  const deleteStmt = db.prepare("DELETE FROM store WHERE collection = ? AND key = ?");
  return {
    getItem: (c, k, fallback) => {
      const row = getStmt.get(c, k);
      return row ? JSON.parse(row.value) : fallback;
    },
    getCollection: (c) => {
      const out = {};
      for (const row of getAllStmt.all(c)) out[row.key] = JSON.parse(row.value);
      return out;
    },
    setItem: (c, k, v) => setStmt.run(c, k, JSON.stringify(v)),
    deleteItem: (c, k) => deleteStmt.run(c, k),
  };
})();

const username = process.argv[2];
const confirm = process.argv.includes("--yes");

if (!username) {
  console.error("Usage: node scripts/delete-user.js <username> [--yes]");
  process.exit(1);
}

const users = getCollection("users");
const entry = Object.entries(users).find(([, u]) => u.username?.toLowerCase() === username.toLowerCase());
if (!entry) {
  console.error(`No user found with username "${username}"`);
  process.exit(1);
}
const [userId, user] = entry;

const plan = [`users/${userId}  (${user.role}, ${user.name}, ${user.email || "no email"})`];
const actions = [];

actions.push(() => deleteItem("users", userId));

if (user.role === "coach") {
  // Their own client roster, and anything keyed by coachId.
  for (const key of ["relationships", "checkinTemplates", "calendarEvents", "calendarEventTypes", "reviews"]) {
    if (getItem(key, userId, null) !== null) {
      plan.push(`${key}/${userId}`);
      actions.push(() => deleteItem(key, userId));
    }
  }
  const ads = getItem("ads", "_all", []);
  if (ads.some((a) => a.coachId === userId)) {
    plan.push(`ads/_all — remove this coach's post`);
    actions.push(() => setItem("ads", "_all", ads.filter((a) => a.coachId !== userId)));
  }
  // Any invite tokens they generated.
  const invites = getCollection("invites");
  for (const [token, inv] of Object.entries(invites)) {
    if (inv.coachId === userId) {
      plan.push(`invites/${token}`);
      actions.push(() => deleteItem("invites", token));
    }
  }
  // Remove them from every OTHER coach's roster is a no-op (coaches don't
  // list other coaches as clients), but drop this coach's own client list
  // membership entries the other direction: nothing to do, relationships is
  // keyed by coachId only.
} else {
  // Client-owned data.
  for (const key of ["sheets", "checkinSubmissions", "clientNotes", "paymentPlans"]) {
    if (getItem(key, userId, null) !== null) {
      plan.push(`${key}/${userId}`);
      actions.push(() => deleteItem(key, userId));
    }
  }
  // Remove them from whichever coach's roster they're on.
  const relationships = getCollection("relationships");
  for (const [coachId, clientIds] of Object.entries(relationships)) {
    if (clientIds.includes(userId)) {
      plan.push(`relationships/${coachId} — remove this client`);
      actions.push(() => setItem("relationships", coachId, clientIds.filter((id) => id !== userId)));
    }
  }
  // Remove their review of any coach.
  const reviews = getCollection("reviews");
  for (const [coachId, list] of Object.entries(reviews)) {
    if (list.some((r) => r.clientId === userId)) {
      plan.push(`reviews/${coachId} — remove this client's review`);
      actions.push(() => setItem("reviews", coachId, list.filter((r) => r.clientId !== userId)));
    }
  }
}

// Message threads involving this user, either role — keys are "idA_idB" sorted.
const messages = getCollection("messages");
for (const key of Object.keys(messages)) {
  if (key.split("_").includes(userId)) {
    plan.push(`messages/${key}`);
    actions.push(() => deleteItem("messages", key));
  }
}

console.log(`About to delete ${plan.length} record(s):\n  ` + plan.join("\n  "));

if (!confirm) {
  console.log("\nDry run only — nothing deleted. Re-run with --yes to actually delete.");
  process.exit(0);
}

for (const action of actions) action();
console.log("\nDone.");
