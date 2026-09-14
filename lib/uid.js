const crypto = require("crypto");

function uid(prefix = "") {
  return prefix + crypto.randomBytes(8).toString("hex");
}

module.exports = { uid };
