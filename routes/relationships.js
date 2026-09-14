const express = require("express");
const router = express.Router();
const { getUser, getClientIds, addRelationship, getCoachIdForClient, saveInvite, getInvite, getSheets, getCheckinSubmissions } = require("../db");
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

router.post("/clients", requireRole("coach"), (req, res) => {
  const { clientId } = req.body;
  const client = getUser(clientId);
  if (!client || client.role !== "client") return res.status(400).json({ error: "Client not found" });

  const currentCount = getClientIds(req.user.id).length;
  const tier = tierForCoach(req.user);
  if (currentCount >= tier.max) {
    return res.status(400).json({ error: `You're at your ${tier.label} plan limit (${tier.max}). Upgrade on the Membership tab to add more clients.` });
  }
  addRelationship(req.user.id, clientId);
  res.json({ ok: true });
});

// The logged-in client's coach (or null if not connected yet).
router.get("/my-coach", requireRole("client"), (req, res) => {
  const coachId = getCoachIdForClient(req.user.id);
  const coach = coachId ? getUser(coachId) : null;
  res.json({ coach: coach ? publicUser(coach) : null });
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
