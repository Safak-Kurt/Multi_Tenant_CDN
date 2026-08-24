const {
  randomBytes,
  createHash,
} = require("node:crypto");

function hashApiKey(apiKey) {
  return createHash("sha256")
    .update(apiKey)
    .digest("hex");
}

function generateApiKey() {
  const randomPart = randomBytes(32).toString("hex");

  const apiKey = `cdn_${randomPart}`;

  const keyHash = hashApiKey(apiKey);

  const keyPrefix = apiKey.slice(0, 12);

  return {
    apiKey,
    keyHash,
    keyPrefix,
  };
}

module.exports = {
  generateApiKey,
  hashApiKey,
};
