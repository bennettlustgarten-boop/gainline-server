const express = require("express");
const router = express.Router();
const { searchClients, getUser, isBlockedEitherWay } = require("../db");
const { publicUser } = require("../lib/publicUser");
const { requireVerified, requireRole } = require("../middleware/auth");

// Only the coach dashboard's "add a client" box uses this — clients had no
// reason to be able to page through every other client on the platform.
// Capped so a one-letter query can't dump the whole user list either.
router.get("/search", requireRole("coach"), (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });
  const users = searchClients(q).filter((u) => !isBlockedEitherWay(req.user.id, u.id)).slice(0, 20);
  res.json({ users: users.map(publicUser) });
});

router.get("/:id", requireVerified, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

module.exports = router;
