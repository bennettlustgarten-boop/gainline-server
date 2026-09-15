// Base directory for everything that must survive a redeploy: the SQLite
// database and uploaded files. Render (and most PaaS hosts) replace the
// app's own folder entirely on every deploy — a persistent disk has to be
// mounted at a separate path instead, given here via DATA_DIR. Locally
// (DATA_DIR unset) this just falls back to the project root, matching the
// original behavior.
const path = require("path");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..");

module.exports = { DATA_DIR };
