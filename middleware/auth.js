const { getUser } = require("../db");

function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not logged in" });
  const user = getUser(userId);
  if (!user) return res.status(401).json({ error: "Not logged in" });
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (req.user.role !== role) {
        return res.status(403).json({ error: `Only ${role}s can do this` });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireRole };
