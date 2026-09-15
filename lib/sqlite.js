// Shared SQLite connection used by both the data store (db.js) and the
// session store (lib/sqliteSessionStore.js). Uses Node's built-in
// node:sqlite (no native compile step, no extra dependency) — needs
// Node >= 22.5.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const { DATA_DIR } = require("./dataDir");

const DB_FILE = path.join(DATA_DIR, "data.db");

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS store (
    collection TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (collection, key)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );
`);

module.exports = { db };
