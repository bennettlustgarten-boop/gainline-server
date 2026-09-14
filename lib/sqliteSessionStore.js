// A minimal express-session Store backed by the same SQLite file as the
// data store, replacing the default in-memory session store (which loses
// every logged-in session on restart and leaks memory over time).
const session = require("express-session");
const { db } = require("./sqlite");

const getStmt = db.prepare("SELECT data, expiresAt FROM sessions WHERE sid = ?");
const setStmt = db.prepare(
  "INSERT INTO sessions (sid, data, expiresAt) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expiresAt = excluded.expiresAt"
);
const destroyStmt = db.prepare("DELETE FROM sessions WHERE sid = ?");
const pruneStmt = db.prepare("DELETE FROM sessions WHERE expiresAt < ?");

const DAY_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    pruneStmt.run(Date.now());
    this._pruneInterval = setInterval(() => pruneStmt.run(Date.now()), DAY_MS).unref();
  }

  get(sid, cb) {
    try {
      const row = getStmt.get(sid);
      if (!row || row.expiresAt < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? DAY_MS;
      setStmt.run(sid, JSON.stringify(sessionData), Date.now() + maxAge);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      destroyStmt.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

module.exports = SqliteSessionStore;
