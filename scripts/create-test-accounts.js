// Creates (or resets) two throwaway, pre-verified accounts — a coach and a
// client, already connected — for demos and screen recordings (e.g. showing
// account deletion on camera without touching the App Review demo accounts,
// see create-review-accounts.js). Run on the Render Shell:
//
//   node scripts/create-test-accounts.js
//
// Prints a fresh random password once. Re-running deletes and recreates both,
// so it's also how you get them back after deleting them in a recording.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { saveUser, findUserByUsername, deleteUserCascade, addRelationship, addMessage } = require("../db");
const { uid } = require("../lib/uid");

const COACH_USERNAME = "tester_coach";
const CLIENT_USERNAME = "tester_client";

for (const username of [COACH_USERNAME, CLIENT_USERNAME]) {
  const existing = findUserByUsername(username);
  if (existing) deleteUserCascade(existing.id);
}

const password = crypto.randomBytes(9).toString("base64url") + "!7";
const passwordHash = bcrypt.hashSync(password, 10);
const now = Date.now();

function createUser(role, name, username, extra) {
  const id = uid(role === "coach" ? "coach_" : "client_");
  saveUser(id, {
    id, role, name, username,
    email: `${username}@gainlineapp.online`,
    passwordHash, createdAt: now, emailVerified: true,
    ...extra,
  });
  return id;
}

const coachId = createUser("coach", "Test Coach", COACH_USERNAME, {
  bio: "Test coach account for demos.",
  membershipTier: "free",
  coachSurveyComplete: true,
});
const clientId = createUser("client", "Test Client", CLIENT_USERNAME, {});
addRelationship(coachId, clientId);
addMessage(coachId, clientId, { id: uid("m_"), from: coachId, text: "Welcome to Gainline! Let me know if you have any questions.", at: now });

console.log("Test accounts ready:\n");
console.log(`  Coach   username: ${COACH_USERNAME}`);
console.log(`  Client  username: ${CLIENT_USERNAME}`);
console.log(`  Password (both):  ${password}`);
console.log("\nShown only once — re-run the script for a new password.");
