const express = require("express");
const router = express.Router();
const {
  getUser,
  getClientIds,
  getCoachIdForClient,
  addCalendarEvent,
  getCalendarEvents,
  removeCalendarEvent,
  addCalendarEventType,
  getCalendarEventTypes,
  removeCalendarEventType,
} = require("../db");
const { uid } = require("../lib/uid");
const { expandOccurrences, DEFAULT_WINDOW_MS } = require("../lib/calendar");
const { requireAuth, requireRole } = require("../middleware/auth");

const DEFAULT_TYPES = ["In-person training", "Check-in"];

// ---- Event types (coach-managed labels, e.g. "In-person training") --------------

// Seeds two sensible defaults the first time a coach looks at their type
// list, but they're free to rename that away — add/delete whatever they want.
router.get("/types", requireRole("coach"), (req, res) => {
  let types = getCalendarEventTypes(req.user.id);
  if (!types.length) {
    DEFAULT_TYPES.forEach((label) => {
      types = addCalendarEventType(req.user.id, { id: uid("ctype_"), label });
    });
  }
  res.json({ types });
});

router.post("/types", requireRole("coach"), (req, res) => {
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: "label is required" });
  const type = { id: uid("ctype_"), label: label.trim() };
  res.json({ types: addCalendarEventType(req.user.id, type) });
});

router.delete("/types/:typeId", requireRole("coach"), (req, res) => {
  res.json({ types: removeCalendarEventType(req.user.id, req.params.typeId) });
});

// ---- Events -----------------------------------------------------------------

// Schedule something with a client — typeLabel is whichever of the coach's
// own custom types they picked (e.g. "In-person training", "Check-in", or
// anything else they've added). Baked into the event as plain text so it
// stays stable even if the type is later deleted from their list. Either
// one-time or repeats weekly (optionally until a given date).
router.post("/events", requireRole("coach"), (req, res) => {
  const { clientId, typeLabel, title, startAt, durationMinutes, recurrence, until } = req.body;
  if (!clientId || !typeLabel?.trim() || !startAt) {
    return res.status(400).json({ error: "clientId, typeLabel, and startAt are required" });
  }
  if (!getClientIds(req.user.id).includes(clientId)) {
    return res.status(400).json({ error: "That's not one of your clients" });
  }
  const startMs = new Date(startAt).getTime();
  if (Number.isNaN(startMs)) return res.status(400).json({ error: "Invalid startAt" });

  const event = {
    id: uid("evt_"),
    clientId,
    typeLabel: typeLabel.trim(),
    title: (title || "").trim(),
    startAt: startMs,
    durationMinutes: Number(durationMinutes) || 60,
    recurrence: recurrence === "weekly" ? "weekly" : "none",
    until: recurrence === "weekly" && until ? new Date(until).getTime() : null,
    createdAt: Date.now(),
  };
  res.json({ events: addCalendarEvent(req.user.id, event) });
});

// Returns flattened occurrences (not raw recurring events) so the calendar
// view can just render them directly. A coach sees every client's
// occurrences; a client sees only their own. Pass ?from=&to= (ISO strings)
// to scope to a specific range — e.g. the month currently on screen; without
// them this defaults to "now through the next ~3 months".
router.get("/events", requireAuth, (req, res) => {
  const coachId = req.user.role === "coach" ? req.user.id : getCoachIdForClient(req.user.id);
  if (!coachId) return res.json({ occurrences: [] });

  const rangeStart = req.query.from ? new Date(req.query.from).getTime() : Date.now();
  const rangeEndInput = req.query.to ? new Date(req.query.to).getTime() : rangeStart + DEFAULT_WINDOW_MS;
  const windowMs = Math.max(rangeEndInput - rangeStart, 0);

  const events = getCalendarEvents(coachId).filter((e) => req.user.role === "coach" || e.clientId === req.user.id);
  const clientCache = {};
  const occurrences = [];
  for (const event of events) {
    if (!clientCache[event.clientId]) clientCache[event.clientId] = getUser(event.clientId);
    const client = clientCache[event.clientId];
    for (const occursAt of expandOccurrences(event, rangeStart, windowMs)) {
      occurrences.push({
        eventId: event.id,
        clientId: event.clientId,
        clientName: client?.name || "Client",
        typeLabel: event.typeLabel,
        title: event.title,
        occursAt,
        durationMinutes: event.durationMinutes,
        recurrence: event.recurrence,
      });
    }
  }
  occurrences.sort((a, b) => a.occursAt - b.occursAt);
  res.json({ occurrences });
});

router.delete("/events/:eventId", requireRole("coach"), (req, res) => {
  const exists = getCalendarEvents(req.user.id).some((e) => e.id === req.params.eventId);
  if (!exists) return res.status(404).json({ error: "Event not found" });
  res.json({ events: removeCalendarEvent(req.user.id, req.params.eventId) });
});

module.exports = router;
