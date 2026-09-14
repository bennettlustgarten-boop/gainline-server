const express = require("express");
const router = express.Router();
const { searchClients, getUser } = require("../db");
const { publicUser } = require("../lib/publicUser");
const { requireAuth } = require("../middleware/auth");

router.get("/search", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });
  res.json({ users: searchClients(q).map(publicUser) });
});

router.get("/:id", requireAuth, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

module.exports = router;
