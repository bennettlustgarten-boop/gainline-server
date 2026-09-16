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
//
// Same cascade-delete logic as the admin dashboard's "Delete user" button
// (see db.js's deleteUserCascade) — this CLI just adds the dry-run/--yes
// confirmation step on top, for one-off manual cleanup.
const { findUserByUsername, deleteUserCascade } = require("../db");

const username = process.argv[2];
const confirm = process.argv.includes("--yes");

if (!username) {
  console.error("Usage: node scripts/delete-user.js <username> [--yes]");
  process.exit(1);
}

const user = findUserByUsername(username);
if (!user) {
  console.error(`No user found with username "${username}"`);
  process.exit(1);
}

if (!confirm) {
  console.log(`About to delete user "${username}" (${user.role}, ${user.name}, ${user.email || "no email"}) and everything tied to their account.`);
  console.log("\nDry run only — nothing deleted. Re-run with --yes to actually delete.");
  process.exit(0);
}

const { deleted } = deleteUserCascade(user.id);
console.log(`Deleted ${deleted.length} record(s):\n  ` + deleted.join("\n  "));
console.log("\nDone.");
