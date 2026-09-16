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

// Admin is a completely separate session flag from the coach/client account
// system (see routes/admin.js) — it's not a role on a users row, just a
// single operator login gated by an env var, so it can't be reached via the
// public signup form no matter what.
function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(401).json({ error: "Not logged in" });
  next();
}

module.exports = { requireAuth, requireRole, requireAdmin };
