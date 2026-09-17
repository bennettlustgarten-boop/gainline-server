const express = require("express");
const router = express.Router();
const { searchClients, getUser } = require("../db");
const { publicUser } = require("../lib/publicUser");
const { requireVerified } = require("../middleware/auth");

router.get("/search", requireVerified, (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });
  res.json({ users: searchClients(q).map(publicUser) });
});

router.get("/:id", requireVerified, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

module.exports = router;
