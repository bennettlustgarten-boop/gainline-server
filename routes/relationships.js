const express = require("express");
const router = express.Router();
const {
  getUser,
  getClientIds,
  addRelationship,
  removeRelationship,
  addClientRequest,
  getClientRequests,
  removeClientRequest,
  getCoachIdForClient,
  saveInvite,
  getInvite,
  getSheets,
  getCheckinSubmissions,
} = require("../db");
const { uid } = require("../lib/uid");
const { publicUser } = require("../lib/publicUser");
const { tierForCoach } = require("../lib/tiers");
const { requireRole } = require("../middleware/auth");

// Coach's client roster, with sheet/check-in counts for the overview screen.
router.get("/clients", requireRole("coach"), (req, res) => {
  const clients = getClientIds(req.user.id)
    .map((id) => getUser(id))
    .filter(Boolean)
    .map((c) => ({
      ...publicUser(c),
      sheetCount: getSheets(c.id).length,
      checkinCount: getCheckinSubmissions(c.id).length,
    }));
  res.json({ clients, tier: tierForCoach(req.user) });
});

// Sends the client a connection request rather than adding them straight to
// the roster — they have to accept it (see /client-requests below) before
// addRelationship() ever runs, so a coach can't attach themselves to
// someone's account without that person's say-so.
router.post("/clients", requireRole("coach"), (req, res) => {
  const { clientId } = req.body;
  const client = getUser(clientId);
  if (!client || client.role !== "client") return res.status(400).json({ error: "Client not found" });
  if (getClientIds(req.user.id).includes(clientId)) {
    return res.status(400).json({ error: "Already one of your clients" });
  }

  const currentCount = getClientIds(req.user.id).length;
  const tier = tierForCoach(req.user);
  if (currentCount >= tier.max) {
    return res.status(400).json({ error: `You're at your ${tier.label} plan limit (${tier.max}). Upgrade on the Membership tab to add more clients.` });
  }

  if (getClientRequests(clientId).some((r) => r.coachId === req.user.id)) {
    return res.json({ ok: true, alreadySent: true });
  }
  addClientRequest(clientId, { id: uid("req_"), coachId: req.user.id, createdAt: Date.now() });
  res.json({ ok: true });
});

// Coach removes a client from their own roster — the client keeps their
// account and history, they're just no longer connected to this coach.
router.delete("/clients/:clientId", requireRole("coach"), (req, res) => {
  const { clientId } = req.params;
  if (!getClientIds(req.user.id).includes(clientId)) return res.status(404).json({ error: "That's not one of your clients" });
  removeRelationship(req.user.id, clientId);
  res.json({ ok: true });
});

// The logged-in client's coach (or null if not connected yet).
router.get("/my-coach", requireRole("client"), (req, res) => {
  const coachId = getCoachIdForClient(req.user.id);
  const coach = coachId ? getUser(coachId) : null;
  res.json({ coach: coach ? publicUser(coach) : null });
});

// Client disconnects from their own coach — same effect as the coach
// removing them, just initiated from the other side.
router.delete("/my-coach", requireRole("client"), (req, res) => {
  const coachId = getCoachIdForClient(req.user.id);
  if (!coachId) return res.status(400).json({ error: "You're not connected to a coach" });
  removeRelationship(coachId, req.user.id);
  res.json({ ok: true });
});

// Client-initiated "request to connect" from the ad feed — auto-accepts as
// long as the coach has an open slot on their current membership tier.
router.post("/connect", requireRole("client"), (req, res) => {
  const { coachId } = req.body;
  const coach = getUser(coachId);
  if (!coach || coach.role !== "coach") return res.status(400).json({ error: "Coach not found" });
  if (getCoachIdForClient(req.user.id) === coachId) return res.json({ ok: true });

  const currentCount = getClientIds(coachId).length;
  const tier = tierForCoach(coach);
  if (currentCount >= tier.max) {
    return res.status(400).json({ error: `${coach.name} is fully booked right now.` });
  }
  addRelationship(coachId, req.user.id);
  res.json({ ok: true });
});

// The logged-in client's pending "a coach wants to add you" requests.
router.get("/client-requests", requireRole("client"), (req, res) => {
  const requests = getClientRequests(req.user.id)
    .map((r) => {
      const coach = getUser(r.coachId);
      return coach ? { id: r.id, coachId: r.coachId, coachName: coach.name, coachUsername: coach.username, bio: coach.bio || "", createdAt: r.createdAt } : null;
    })
    .filter(Boolean);
  res.json({ requests });
});

router.post("/client-requests/:requestId/accept", requireRole("client"), (req, res) => {
  const { requestId } = req.params;
  const requests = getClientRequests(req.user.id);
  const request = requests.find((r) => r.id === requestId);
  if (!request) return res.status(404).json({ error: "Request not found" });

  const coach = getUser(request.coachId);
  if (!coach) return res.status(400).json({ error: "That coach's account no longer exists" });
  const currentCount = getClientIds(request.coachId).length;
  const tier = tierForCoach(coach);
  if (currentCount >= tier.max) {
    return res.status(400).json({ error: `${coach.name} is now fully booked — they'll need to free up a slot first.` });
  }

  addRelationship(request.coachId, req.user.id);
  // Only one coach makes sense at a time, so accepting this one clears out
  // whatever else was pending rather than leaving stale requests around.
  requests.forEach((r) => removeClientRequest(req.user.id, r.id));
  res.json({ ok: true, coach: publicUser(coach) });
});

router.post("/client-requests/:requestId/decline", requireRole("client"), (req, res) => {
  const { requestId } = req.params;
  if (!getClientRequests(req.user.id).some((r) => r.id === requestId)) {
    return res.status(404).json({ error: "Request not found" });
  }
  removeClientRequest(req.user.id, requestId);
  res.json({ ok: true });
});

router.post("/invites", requireRole("coach"), (req, res) => {
  const token = uid("inv_");
  saveInvite(token, { coachId: req.user.id, createdAt: Date.now() });
  res.json({ token });
});

// Public (no auth) — the signup page needs to show "invited by X" before the
// visitor has an account.
router.get("/invites/:token", (req, res) => {
  const invite = getInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  const coach = getUser(invite.coachId);
  res.json({ coachId: invite.coachId, coachName: coach?.name || null });
});

module.exports = router;
