const crypto = require("crypto");
const canonicalStringify = require("./canonicalStringify");

module.exports = function generateBlockHash(payload) {
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");
};
