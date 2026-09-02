const pool = require("../db/pool");

const {
  verifySignedUrl
} = require("../services/signedUrlService");

function getRequestHostname(req) {
  const forwardedHost =
    req.headers["x-forwarded-host"];

  const rawHost =
    (
      Array.isArray(forwardedHost)
        ? forwardedHost[0]
        : forwardedHost
    ) ||
    req.headers.host ||
    "";

  return rawHost
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function extractTenantSlug(req) {
  const hostname =
    getRequestHostname(req);

  if (!hostname) {
    return null;
  }

  const parts =
    hostname.split(".");

  if (parts.length < 2) {
    return null;
  }

  return parts[0] || null;
}

function getObjectPath(req) {
  const param =
    req.params.objectPath;

  if (Array.isArray(param)) {
    return param.join("/");
  }

  return String(param || "");
}

async function authenticateSignedUrl(
  req,
  res,
  next
) {
  try {
    const {
      expires,
      signature
    } = req.query;

    if (!expires || !signature) {
      return res.status(403).json({
        error:
          "Signed URL parameters are required",
        reason:
          "missing_signature_parameters"
      });
    }

    const tenantSlug =
      extractTenantSlug(req);

    if (!tenantSlug) {
      return res.status(403).json({
        error: "Invalid signed URL",
        reason: "invalid_tenant_host"
      });
    }

    const result =
      await pool.query(
        `
          SELECT
            id,
            name,
            slug,
            bucket_name,
            status
          FROM tenants
          WHERE slug = $1
          LIMIT 1
        `,
        [tenantSlug]
      );

    if (result.rowCount !== 1) {
      return res.status(403).json({
        error: "Invalid signed URL",
        reason: "unknown_tenant"
      });
    }

    const tenant =
      result.rows[0];

    if (tenant.status !== "active") {
      return res.status(403).json({
        error: "Invalid signed URL",
        reason: "inactive_tenant"
      });
    }

    const objectPath =
      getObjectPath(req);

    const verification =
      verifySignedUrl({
        tenantId: tenant.id,
        objectPath,
        expires,
        signature
      });

    if (!verification.valid) {
      return res.status(403).json({
        error: "Invalid signed URL",
        reason:
          verification.reason
      });
    }

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      bucketName:
        tenant.bucket_name
    };

    req.auth = {
      type: "signed-url",
      expires:
        verification.expires
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  authenticateSignedUrl
};
