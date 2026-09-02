const {
  createHmac,
  timingSafeEqual
} = require("node:crypto");

const SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET;

const DEFAULT_TTL_SECONDS = Number.parseInt(
  process.env.SIGNED_URL_DEFAULT_TTL_SECONDS || "300",
  10
);

const MAX_TTL_SECONDS = Number.parseInt(
  process.env.SIGNED_URL_MAX_TTL_SECONDS || "3600",
  10
);

if (!SIGNED_URL_SECRET) {
  throw new Error("SIGNED_URL_SECRET environment variable is required");
}

function normalizeObjectPath(objectPath) {
  if (typeof objectPath !== "string") {
    throw new Error("objectPath must be a string");
  }

  const normalized = objectPath
    .trim()
    .replace(/^\/+/, "");

  if (!normalized) {
    throw new Error("objectPath cannot be empty");
  }

  if (normalized.includes("\0")) {
    throw new Error("objectPath contains invalid characters");
  }

  return normalized;
}

function buildSigningPayload({
  tenantId,
  objectPath,
  expires
}) {
  const normalizedPath = normalizeObjectPath(objectPath);

  return [
    "GET",
    String(tenantId),
    normalizedPath,
    String(expires)
  ].join("\n");
}

function createSignature({
  tenantId,
  objectPath,
  expires
}) {
  const payload = buildSigningPayload({
    tenantId,
    objectPath,
    expires
  });

  return createHmac("sha256", SIGNED_URL_SECRET)
    .update(payload, "utf8")
    .digest("hex");
}

function signaturesMatch(providedSignature, expectedSignature) {
  if (
    typeof providedSignature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(providedSignature)
  ) {
    return false;
  }

  const providedBuffer = Buffer.from(
    providedSignature,
    "hex"
  );

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "hex"
  );

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(
    providedBuffer,
    expectedBuffer
  );
}

function createSignedUrlData({
  tenantId,
  objectPath,
  expiresInSeconds = DEFAULT_TTL_SECONDS
}) {
  const ttl = Number(expiresInSeconds);

  if (
    !Number.isInteger(ttl) ||
    ttl <= 0
  ) {
    throw new Error(
      "expiresInSeconds must be a positive integer"
    );
  }

  if (ttl > MAX_TTL_SECONDS) {
    throw new Error(
      `expiresInSeconds cannot exceed ${MAX_TTL_SECONDS}`
    );
  }

  const normalizedPath = normalizeObjectPath(
    objectPath
  );

  const expires =
    Math.floor(Date.now() / 1000) + ttl;

  const signature = createSignature({
    tenantId,
    objectPath: normalizedPath,
    expires
  });

  return {
    objectPath: normalizedPath,
    expires,
    signature
  };
}

function verifySignedUrl({
  tenantId,
  objectPath,
  expires,
  signature,
  now = Math.floor(Date.now() / 1000)
}) {
  const expiresNumber = Number(expires);

  if (
    !Number.isInteger(expiresNumber) ||
    expiresNumber <= 0
  ) {
    return {
      valid: false,
      reason: "invalid_expiry"
    };
  }

  if (expiresNumber <= now) {
    return {
      valid: false,
      reason: "expired"
    };
  }

  let normalizedPath;

  try {
    normalizedPath = normalizeObjectPath(
      objectPath
    );
  } catch {
    return {
      valid: false,
      reason: "invalid_path"
    };
  }

  const expectedSignature = createSignature({
    tenantId,
    objectPath: normalizedPath,
    expires: expiresNumber
  });

  if (
    !signaturesMatch(
      signature,
      expectedSignature
    )
  ) {
    return {
      valid: false,
      reason: "invalid_signature"
    };
  }

  return {
    valid: true,
    reason: null,
    objectPath: normalizedPath,
    expires: expiresNumber
  };
}

module.exports = {
  normalizeObjectPath,
  createSignature,
  createSignedUrlData,
  verifySignedUrl,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS
};
