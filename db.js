// ---------------------------------------------------------------------------
// SQLite-backed data store. Each top-level "collection" (users, sheets,
// messages, ...) is stored as JSON blobs keyed by id/coachId/clientId/etc in
// a single `store` table (see lib/sqlite.js) — this keeps the exact same
// shape and function signatures the JSON-file version had, so nothing in
// routes/ had to change, while gaining real persistence, atomic per-row
// writes, and WAL-mode concurrent access.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { db } = require("./lib/sqlite");
const { DATA_DIR } = require("./lib/dataDir");

function unlinkQuiet(filePath) {
  fs.unlink(filePath, () => {});
}

const getStmt = db.prepare("SELECT value FROM store WHERE collection = ? AND key = ?");
const getAllStmt = db.prepare("SELECT key, value FROM store WHERE collection = ?");
const setStmt = db.prepare(
  "INSERT INTO store (collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value"
);
const deleteStmt = db.prepare("DELETE FROM store WHERE collection = ? AND key = ?");
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM store");

function getItem(collection, key, fallback) {
  const row = getStmt.get(collection, key);
  return row ? JSON.parse(row.value) : fallback;
}

function getCollection(collection) {
  const rows = getAllStmt.all(collection);
  const out = {};
  for (const row of rows) out[row.key] = JSON.parse(row.value);
  return out;
}

function setItem(collection, key, value) {
  setStmt.run(collection, key, JSON.stringify(value));
  return value;
}

function deleteItem(collection, key) {
  deleteStmt.run(collection, key);
}

// One-time import from the old data.json file, if present and the SQLite
// store is still empty — keeps existing accounts/sheets/etc. intact when
// upgrading from the old JSON-file store instead of starting over.
(function migrateFromJsonIfNeeded() {
  const legacyFile = path.join(__dirname, "data.json");
  if (!fs.existsSync(legacyFile)) return;
  if (countStmt.get().n > 0) return;

  const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
  for (const [collection, value] of Object.entries(legacy)) {
    if (Array.isArray(value)) {
      setItem(collection, "_all", value);
    } else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) setItem(collection, key, v);
    }
  }
  console.log("db: imported existing data.json into data.db");
})();

// ---- Users (coaches and clients) ------------------------------------------

function getUser(userId) {
  return getItem("users", userId, null);
}

function saveUser(userId, data) {
  const merged = { ...getItem("users", userId, null), ...data };
  return setItem("users", userId, merged);
}

function findUserByUsername(username) {
  const lower = username.toLowerCase();
  return Object.values(getCollection("users")).find((u) => u.username?.toLowerCase() === lower) || null;
}

function findUserByEmail(email) {
  const lower = email.toLowerCase();
  return Object.values(getCollection("users")).find((u) => u.email?.toLowerCase() === lower) || null;
}

function findUserByStripeAccountId(stripeAccountId) {
  return Object.entries(getCollection("users")).find(([, u]) => u.stripeAccountId === stripeAccountId);
}

function findUserByStripeCustomerId(stripeCustomerId) {
  return Object.entries(getCollection("users")).find(([, u]) => u.stripeCustomerId === stripeCustomerId);
}

function findUserBySubscriptionId(subscriptionId, field) {
  return Object.entries(getCollection("users")).find(([, u]) => u[field] === subscriptionId);
}

function findUserByEmailVerifyToken(token) {
  return Object.values(getCollection("users")).find((u) => u.emailVerifyToken === token) || null;
}

function findUserByPasswordResetToken(token) {
  return Object.values(getCollection("users")).find((u) => u.passwordResetToken === token) || null;
}

function searchClients(query) {
  const q = query.toLowerCase();
  return Object.values(getCollection("users")).filter(
    (u) => u.role === "client" && (u.name.toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q))
  );
}

function listOnboardedCoaches() {
  return Object.values(getCollection("users"))
    .filter((u) => u.role === "coach" && u.onboardingComplete)
    .map((c) => ({ coachId: c.id, name: c.name || c.id, username: c.username, bio: c.bio || "" }));
}

// ---- Coach <-> client relationships ----------------------------------------

function getClientIds(coachId) {
  return getItem("relationships", coachId, []);
}

function getCoachIdForClient(clientId) {
  const entry = Object.entries(getCollection("relationships")).find(([, ids]) => ids.includes(clientId));
  return entry ? entry[0] : null;
}

function addRelationship(coachId, clientId) {
  const current = getItem("relationships", coachId, []);
  if (current.includes(clientId)) return current;
  return setItem("relationships", coachId, [...current, clientId]);
}

function removeRelationship(coachId, clientId) {
  return setItem("relationships", coachId, getItem("relationships", coachId, []).filter((id) => id !== clientId));
}

// ---- Coach -> client connection requests -------------------------------------
// A coach adding an existing client now sends a request instead of an
// instant add — the client has to accept before addRelationship() runs.

function addClientRequest(clientId, request) {
  return setItem("clientRequests", clientId, [...getItem("clientRequests", clientId, []), request]);
}

function getClientRequests(clientId) {
  return getItem("clientRequests", clientId, []);
}

function removeClientRequest(clientId, requestId) {
  return setItem("clientRequests", clientId, getItem("clientRequests", clientId, []).filter((r) => r.id !== requestId));
}

// ---- Invites ----------------------------------------------------------------

function saveInvite(token, data) {
  setItem("invites", token, data);
}

function getInvite(token) {
  return getItem("invites", token, null);
}

// ---- Sheets (workout / diet plans) ------------------------------------------

function addSheet(clientId, sheet) {
  return setItem("sheets", clientId, [...getItem("sheets", clientId, []), sheet]);
}

function getSheets(clientId) {
  return getItem("sheets", clientId, []);
}

// ---- Check-in templates & submissions ---------------------------------------

function addCheckinTemplate(coachId, template) {
  return setItem("checkinTemplates", coachId, [...getItem("checkinTemplates", coachId, []), template]);
}

function getCheckinTemplates(coachId) {
  return getItem("checkinTemplates", coachId, []);
}

function addCheckinSubmission(clientId, submission) {
  return setItem("checkinSubmissions", clientId, [...getItem("checkinSubmissions", clientId, []), submission]);
}

function getCheckinSubmissions(clientId) {
  return getItem("checkinSubmissions", clientId, []);
}

// ---- Messages -----------------------------------------------------------------

function pairKey(userIdA, userIdB) {
  return [userIdA, userIdB].sort().join("_");
}

function addMessage(userIdA, userIdB, message) {
  const key = pairKey(userIdA, userIdB);
  return setItem("messages", key, [...getItem("messages", key, []), message]);
}

function getMessages(userIdA, userIdB) {
  return getItem("messages", pairKey(userIdA, userIdB), []);
}

// ---- Ads --------------------------------------------------------------------

function listAds() {
  return getItem("ads", "_all", []);
}

function upsertAd(coachId, payload) {
  const withoutMine = listAds().filter((a) => a.coachId !== coachId);
  return setItem("ads", "_all", [...withoutMine, { coachId, ...payload, postedAt: Date.now() }]);
}

function removeAd(coachId) {
  return setItem("ads", "_all", listAds().filter((a) => a.coachId !== coachId));
}

// ---- Payment plans (coach -> client payment requests) -------------------------

function addPaymentPlan(clientId, plan) {
  return setItem("paymentPlans", clientId, [...getItem("paymentPlans", clientId, []), plan]);
}

function getPaymentPlans(clientId) {
  return getItem("paymentPlans", clientId, []);
}

function updatePaymentPlan(clientId, planId, patch) {
  const list = getItem("paymentPlans", clientId, []);
  const idx = list.findIndex((p) => p.id === planId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  setItem("paymentPlans", clientId, list);
  return list[idx];
}

// Payment plans are looked up by planId alone in the webhook (Stripe doesn't
// know which client a plan belongs to, just the metadata we gave it), so this
// scans across clients — fine at this scale, same tradeoff as before.
function findPaymentPlan(planId) {
  for (const [clientId, list] of Object.entries(getCollection("paymentPlans"))) {
    const plan = list.find((p) => p.id === planId);
    if (plan) return { clientId, plan };
  }
  return null;
}

// ---- Calendar (in-person sessions / check-in slots) ----------------------------

function addCalendarEvent(coachId, event) {
  return setItem("calendarEvents", coachId, [...getItem("calendarEvents", coachId, []), event]);
}

function getCalendarEvents(coachId) {
  return getItem("calendarEvents", coachId, []);
}

function removeCalendarEvent(coachId, eventId) {
  return setItem("calendarEvents", coachId, getItem("calendarEvents", coachId, []).filter((e) => e.id !== eventId));
}

// Coach-managed calendar event types (e.g. "In-person training", "Check-in",
// or anything else they want to add) — freely add/delete, not a fixed enum.
function addCalendarEventType(coachId, type) {
  return setItem("calendarEventTypes", coachId, [...getItem("calendarEventTypes", coachId, []), type]);
}

function getCalendarEventTypes(coachId) {
  return getItem("calendarEventTypes", coachId, []);
}

function removeCalendarEventType(coachId, typeId) {
  return setItem(
    "calendarEventTypes",
    coachId,
    getItem("calendarEventTypes", coachId, []).filter((t) => t.id !== typeId)
  );
}

// ---- Reviews (client -> coach, 0-5 stars + comment) ----------------------------

// One review per client per coach — a repeat submission (caller passes a
// fully-formed review incl. id/createdAt) replaces theirs in place rather
// than piling up duplicates.
function upsertReview(coachId, clientId, review) {
  const list = getItem("reviews", coachId, []);
  const idx = list.findIndex((r) => r.clientId === clientId);
  if (idx === -1) {
    list.push({ ...review, clientId });
  } else {
    list[idx] = { ...list[idx], ...review, clientId, id: list[idx].id, createdAt: list[idx].createdAt };
  }
  setItem("reviews", coachId, list);
  return list;
}

function getReviews(coachId) {
  return getItem("reviews", coachId, []);
}

// ---- Client notes (coach-private) ----------------------------------------------

function addClientNote(clientId, note) {
  return setItem("clientNotes", clientId, [...getItem("clientNotes", clientId, []), note]);
}

function getClientNotes(clientId) {
  return getItem("clientNotes", clientId, []);
}

function removeClientNote(clientId, noteId) {
  return setItem("clientNotes", clientId, getItem("clientNotes", clientId, []).filter((n) => n.id !== noteId));
}

// ---- Payments log -------------------------------------------------------------

function recordPayment(payment) {
  const list = getItem("payments", "_all", []);
  list.push({ ...payment, createdAt: Date.now() });
  setItem("payments", "_all", list);
}

function getAllPayments() {
  return getItem("payments", "_all", []);
}

// ---- Support requests ----------------------------------------------------------
// No public support inbox anymore (it just got flooded by bots) — the
// "Contact support" form writes here instead, and only the admin dashboard
// can see it. Real requests get a private reply from there.

function addSupportRequest(request) {
  const list = getItem("supportRequests", "_all", []);
  list.push(request);
  setItem("supportRequests", "_all", list);
}

function getSupportRequests() {
  return getItem("supportRequests", "_all", []);
}

function updateSupportRequest(id, patch) {
  const list = getItem("supportRequests", "_all", []);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  setItem("supportRequests", "_all", list);
  return list[idx];
}

function deleteSupportRequest(id) {
  setItem("supportRequests", "_all", getItem("supportRequests", "_all", []).filter((r) => r.id !== id));
}

// ---- Blocking (App Store guideline 1.2: users can block abusive users) --------
// blocks/<blockerId> = [blockedId, ...]. Blocking is checked in both
// directions everywhere (messaging, connection requests, ad feed) so neither
// side can contact the other once either has blocked.

function getBlockedIds(userId) {
  return getItem("blocks", userId, []);
}

function addBlock(blockerId, blockedId) {
  const current = getBlockedIds(blockerId);
  if (current.includes(blockedId)) return current;
  return setItem("blocks", blockerId, [...current, blockedId]);
}

function removeBlock(blockerId, blockedId) {
  return setItem("blocks", blockerId, getBlockedIds(blockerId).filter((id) => id !== blockedId));
}

function isBlockedEitherWay(userIdA, userIdB) {
  return getBlockedIds(userIdA).includes(userIdB) || getBlockedIds(userIdB).includes(userIdA);
}

// ---- Admin -------------------------------------------------------------------

function listAllUsers() {
  return Object.values(getCollection("users"));
}

// Deletes a user and everything tied to them — not just the users row, but
// their relationships, sheets, check-ins, messages, notes, payment plans,
// calendar data, reviews, ads, and pending invites too. Shared by the
// scripts/delete-user.js CLI and the admin dashboard's delete-user route, so
// there's exactly one place this cascade logic lives.
function deleteUserCascade(userId) {
  const user = getUser(userId);
  if (!user) return null;

  const deleted = [`users/${userId}`];
  deleteItem("users", userId);

  if (user.role === "coach") {
    for (const key of ["relationships", "checkinTemplates", "calendarEvents", "calendarEventTypes", "reviews"]) {
      if (getItem(key, userId, null) !== null) {
        deleted.push(`${key}/${userId}`);
        deleteItem(key, userId);
      }
    }
    const ads = getItem("ads", "_all", []);
    const ownAd = ads.find((a) => a.coachId === userId);
    if (ownAd) {
      deleted.push("ads/_all");
      if (ownAd.mediaFile) unlinkQuiet(path.join(DATA_DIR, "uploads", "ads", ownAd.mediaFile));
      setItem("ads", "_all", ads.filter((a) => a.coachId !== userId));
    }
    const invites = getCollection("invites");
    for (const [token, inv] of Object.entries(invites)) {
      if (inv.coachId === userId) {
        deleted.push(`invites/${token}`);
        deleteItem("invites", token);
      }
    }
    // Also clear this coach's own requests to clients that never accepted.
    const clientRequests = getCollection("clientRequests");
    for (const [clientId, requests] of Object.entries(clientRequests)) {
      if (requests.some((r) => r.coachId === userId)) {
        deleted.push(`clientRequests/${clientId}`);
        setItem("clientRequests", clientId, requests.filter((r) => r.coachId !== userId));
      }
    }
  } else {
    const submissions = getItem("checkinSubmissions", userId, null);
    if (submissions) {
      const checkinDir = path.join(DATA_DIR, "uploads", "checkins");
      for (const sub of submissions) {
        (sub.videoFiles || []).forEach((f) => unlinkQuiet(path.join(checkinDir, f)));
        (sub.photos || []).forEach((p) => unlinkQuiet(path.join(checkinDir, p.file)));
      }
    }
    for (const key of ["sheets", "checkinSubmissions", "clientNotes", "paymentPlans", "clientRequests"]) {
      if (getItem(key, userId, null) !== null) {
        deleted.push(`${key}/${userId}`);
        deleteItem(key, userId);
      }
    }
    const relationships = getCollection("relationships");
    for (const [coachId, clientIds] of Object.entries(relationships)) {
      if (clientIds.includes(userId)) {
        deleted.push(`relationships/${coachId}`);
        setItem("relationships", coachId, clientIds.filter((id) => id !== userId));
      }
    }
    const reviews = getCollection("reviews");
    for (const [coachId, list] of Object.entries(reviews)) {
      if (list.some((r) => r.clientId === userId)) {
        deleted.push(`reviews/${coachId}`);
        setItem("reviews", coachId, list.filter((r) => r.clientId !== userId));
      }
    }
  }

  if (getItem("blocks", userId, null) !== null) {
    deleted.push(`blocks/${userId}`);
    deleteItem("blocks", userId);
  }

  const messages = getCollection("messages");
  for (const key of Object.keys(messages)) {
    if (key.split("_").includes(userId)) {
      deleted.push(`messages/${key}`);
      deleteItem("messages", key);
    }
  }

  return { user, deleted };
}

module.exports = {
  getUser,
  saveUser,
  findUserByUsername,
  findUserByStripeAccountId,
  findUserByStripeCustomerId,
  findUserBySubscriptionId,
  findUserByEmail,
  findUserByEmailVerifyToken,
  findUserByPasswordResetToken,
  searchClients,
  listOnboardedCoaches,
  getClientIds,
  getCoachIdForClient,
  addRelationship,
  removeRelationship,
  addClientRequest,
  getClientRequests,
  removeClientRequest,
  saveInvite,
  getInvite,
  addSheet,
  getSheets,
  addCheckinTemplate,
  getCheckinTemplates,
  addCheckinSubmission,
  getCheckinSubmissions,
  pairKey,
  addMessage,
  getMessages,
  listAds,
  upsertAd,
  removeAd,
  addPaymentPlan,
  getPaymentPlans,
  updatePaymentPlan,
  findPaymentPlan,
  addCalendarEvent,
  getCalendarEvents,
  removeCalendarEvent,
  addCalendarEventType,
  getCalendarEventTypes,
  removeCalendarEventType,
  upsertReview,
  getReviews,
  addClientNote,
  getClientNotes,
  removeClientNote,
  recordPayment,
  getAllPayments,
  addSupportRequest,
  getSupportRequests,
  updateSupportRequest,
  deleteSupportRequest,
  listAllUsers,
  deleteUserCascade,
  getBlockedIds,
  addBlock,
  removeBlock,
  isBlockedEitherWay,
};
