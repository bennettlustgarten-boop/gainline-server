const express = require("express");
const router = express.Router();
const { getClientIds, addClientNote, getClientNotes, removeClientNote } = require("../db");
const { uid } = require("../lib/uid");
const { requireRole } = require("../middleware/auth");

// Private notes a coach keeps on a client — never exposed to the client
// themselves, only to the coach who wrote them.
function assertOwnClient(req, clientId) {
  return getClientIds(req.user.id).includes(clientId);
}

router.get("/:clientId", requireRole("coach"), (req, res) => {
  if (!assertOwnClient(req, req.params.clientId)) return res.status(403).json({ error: "Not your client" });
  // Notes are stored per-client, not per-coach, so a client who's had more
  // than one coach (now possible — see relationships.js's remove/re-add
  // flow) could otherwise surface a *previous* coach's private notes to
  // whoever coaches them next. Filter to this coach's own notes only.
  res.json({ notes: getClientNotes(req.params.clientId).filter((n) => n.coachId === req.user.id) });
});

router.post("/", requireRole("coach"), (req, res) => {
  const { clientId, text } = req.body;
  if (!clientId || !text?.trim()) return res.status(400).json({ error: "clientId and text are required" });
  if (!assertOwnClient(req, clientId)) return res.status(403).json({ error: "Not your client" });

  const note = { id: uid("note_"), coachId: req.user.id, text: text.trim(), createdAt: Date.now() };
  res.json({ notes: addClientNote(clientId, note) });
});

router.delete("/:clientId/:noteId", requireRole("coach"), (req, res) => {
  const { clientId, noteId } = req.params;
  if (!assertOwnClient(req, clientId)) return res.status(403).json({ error: "Not your client" });
  const note = getClientNotes(clientId).find((n) => n.id === noteId);
  if (note && note.coachId !== req.user.id) return res.status(403).json({ error: "Not your note" });
  res.json({ notes: removeClientNote(clientId, noteId).filter((n) => n.coachId === req.user.id) });
});

module.exports = router;
