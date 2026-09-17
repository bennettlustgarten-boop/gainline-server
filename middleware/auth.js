const { getUser } = require("../db");

function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not logged in" });
  const user = getUser(userId);
  if (!user) return res.status(401).json({ error: "Not logged in" });
  req.user = user;
  next();
}

// Blocks every real feature (messaging, sheets, check-ins, payments, adding
// clients, etc.) until the account's email is verified — previously this was
// only enforced by the dashboard UI showing a "verify your email" screen,
// but the API itself never checked it, so a script hitting the endpoints
// directly (as a signup-spam bot did) got a fully working account with zero
// verification. /auth/me and /auth/resend-verification intentionally stay on
// bare requireAuth so an unverified user's own dashboard can still load
// enough to show that gate and let them resend the email.
function requireVerified(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.emailVerified) {
      return res.status(403).json({ error: "Please verify your email before continuing — check your inbox for the verification link." });
    }
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    requireVerified(req, res, (err) => {
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

module.exports = { requireAuth, requireVerified, requireRole, requireAdmin };
