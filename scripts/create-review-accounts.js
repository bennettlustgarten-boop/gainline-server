// Creates (or resets) two pre-verified demo accounts for App Store review —
// a client and a coach who are already connected, with a sample workout
// sheet, diet sheet, check-in form, and a short message thread so Apple's
// reviewers see a populated app without having to sign up (signup needs a
// CAPTCHA and email verification, which a reviewer can't complete). Run on
// the Render Shell:
//
//   node scripts/create-review-accounts.js
//
// A fresh random password is generated and printed once — copy it straight
// into App Store Connect's "Sign-In Information" and Notes. Re-running deletes
// the two accounts and recreates them, so it also works as a password reset.
// Uses whichever data.db DATA_DIR resolves to (production disk on Render).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  saveUser, findUserByUsername, deleteUserCascade, addRelationship, addSheet,
  addCheckinTemplate, addMessage,
} = require("../db");
const { uid } = require("../lib/uid");

const CLIENT_USERNAME = "appreview_client";
const COACH_USERNAME = "appreview_coach";

for (const username of [CLIENT_USERNAME, COACH_USERNAME]) {
  const existing = findUserByUsername(username);
  if (existing) deleteUserCascade(existing.id);
}

const password = crypto.randomBytes(9).toString("base64url") + "!9";
const passwordHash = bcrypt.hashSync(password, 10);
const now = Date.now();
const HOUR = 3600000;
const DAY = 24 * HOUR;

function createUser(role, name, username, extra) {
  const id = uid(role === "coach" ? "coach_" : "client_");
  saveUser(id, {
    id, role, name, username,
    email: `${username}@gainlineapp.online`,
    passwordHash,
    createdAt: now,
    emailVerified: true,
    ...extra,
  });
  return id;
}

const coachId = createUser("coach", "Maya Torres", COACH_USERNAME, {
  bio: "Strength and nutrition coach. Helping busy people build sustainable habits.",
  membershipTier: "free",
  coachSurveyComplete: true,
});
const clientId = createUser("client", "Alex Rivera", CLIENT_USERNAME, {});
addRelationship(coachId, clientId);

const ex = (name, sets, reps, weight, rest, notes = "") => ({ id: uid("ex_"), name, sets, reps, weight, rest, notes });
addSheet(clientId, {
  id: uid("sheet_"), type: "workout", title: "Upper / Lower — Week 1",
  columns: { sets: true, reps: true, weight: true, rest: true, notes: true },
  supplements: "", createdAt: now - 3 * DAY,
  days: [
    { id: uid("day_"), name: "Day 1 — Upper", exercises: [
      ex("Barbell Bench Press", "4", "6-8", "135", "120s", "Pause on chest"),
      ex("Bent-Over Row", "4", "8-10", "115", "90s"),
      ex("Overhead Press", "3", "8-10", "75", "90s"),
    ] },
    { id: uid("day_"), name: "Day 2 — Lower", exercises: [
      ex("Back Squat", "4", "5-6", "185", "150s", "Depth to parallel"),
      ex("Romanian Deadlift", "3", "8-10", "155", "90s"),
    ] },
  ],
});

const food = (name, grams, per100) => {
  const f = grams / 100;
  return { id: uid("food_"), name, amount: grams, unit: "g", grams,
    cal: Math.round(per100.cal * f), p: Math.round(per100.p * f * 10) / 10, c: Math.round(per100.c * f * 10) / 10, f: Math.round(per100.f * f * 10) / 10 };
};
const sum = (list) => list.reduce((a, m) => ({ cal: a.cal + m.cal, p: Math.round((a.p + m.p) * 10) / 10, c: Math.round((a.c + m.c) * 10) / 10, f: Math.round((a.f + m.f) * 10) / 10 }), { cal: 0, p: 0, c: 0, f: 0 });
const meal = (name, foods) => ({ id: uid("meal_"), name, foods, totals: sum(foods) });
const meals = [
  meal("Breakfast", [food("Eggs, whole", 150, { cal: 143, p: 12.6, c: 0.7, f: 9.5 }), food("Oats, dry", 60, { cal: 389, p: 16.9, c: 66, f: 6.9 })]),
  meal("Lunch", [food("Chicken breast, cooked", 180, { cal: 165, p: 31, c: 0, f: 3.6 }), food("White rice, cooked", 200, { cal: 130, p: 2.7, c: 28, f: 0.3 })]),
];
addSheet(clientId, {
  id: uid("sheet_"), type: "diet", title: "Lean Bulk — Training Day",
  meals, totals: sum(meals.map((m) => m.totals)), supplements: "", createdAt: now - 2 * DAY,
});

addCheckinTemplate(coachId, {
  id: uid("tmpl_"), title: "Weekly Check-In",
  fields: [
    { id: uid("f_"), kind: "scale", label: "Energy in the gym" },
    { id: uid("f_"), kind: "scale", label: "Sleep quality" },
    { id: uid("f_"), kind: "text", label: "Anything your coach should know this week?" },
  ],
  videoCount: 0, posing: { front: 0, side: 0, back: 0 }, clientId: null, createdAt: now - 10 * DAY,
});

[
  [coachId, "Welcome to Gainline, Alex! Your first workout and diet sheets are in your Sheets tab.", 5 * HOUR],
  [clientId, "Thanks Coach! Excited to get started.", 4 * HOUR],
].forEach(([from, text, ago]) => addMessage(coachId, clientId, { id: uid("m_"), from, text, at: now - ago }));

console.log("Review accounts ready. Copy these into App Store Connect:\n");
console.log(`  Client  username: ${CLIENT_USERNAME}`);
console.log(`  Coach   username: ${COACH_USERNAME}`);
console.log(`  Password (both):  ${password}`);
console.log("\nThis password is shown only once — re-run the script to generate a new one.");
