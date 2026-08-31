const crypto = require("crypto");
const pool = require("../db/pool");

function hashApiKey(apiKey) {
  return crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");
}

function getRequestHost(req) {
  const rawHost =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "";

  return String(rawHost)
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function getTenantSlugFromHost(host) {
  if (!host) {
    return null;
  }

  if (
    host === "localhost" ||
    host === "api" ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
  ) {
    return null;
  }

  if (host.endsWith(".localhost")) {
    const prefix = host.slice(0, -".localhost".length);
    return prefix || null;
  }

  const parts = host.split(".");

  if (parts.length < 3) {
    return null;
  }

  return parts[0];
}

async function authenticateTenant(req, res, next) {
  try {
    const apiKey = req.get("X-API-Key");

    if (!apiKey) {
      return res.status(401).json({
        error: "Missing X-API-Key header",
      });
    }

    if (!apiKey.startsWith("cdn_")) {
      return res.status(401).json({
        error: "Invalid API key",
      });
    }

    const keyHash = hashApiKey(apiKey);

    const result = await pool.query(
      `
        SELECT
          ak.id AS api_key_id,
          t.id AS tenant_id,
          t.name,
          t.slug,
          t.bucket_name,
          t.status
        FROM api_keys ak
        INNER JOIN tenants t
          ON t.id = ak.tenant_id
        WHERE ak.key_hash = $1
          AND ak.revoked_at IS NULL
        LIMIT 1
      `,
      [keyHash]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: "Invalid or revoked API key",
      });
    }

    const record = result.rows[0];

    if (record.status !== "active") {
      return res.status(403).json({
        error: "Tenant is not active",
      });
    }

    const requestHost = getRequestHost(req);
    const hostTenantSlug = getTenantSlugFromHost(requestHost);

    if (
      hostTenantSlug &&
      hostTenantSlug !== record.slug
    ) {
      return res.status(403).json({
        error: "Tenant subdomain does not match API key",
      });
    }

    req.tenant = {
      id: record.tenant_id,
      name: record.name,
      slug: record.slug,
      bucketName: record.bucket_name,
    };

    await pool.query(
      `
        UPDATE api_keys
        SET last_used_at = NOW()
        WHERE id = $1
      `,
      [record.api_key_id]
    );

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticateTenant,
  hashApiKey,
};
