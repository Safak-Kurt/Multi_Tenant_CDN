const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db/pool");
const { generateApiKey } = require("../services/apiKeyService");

const router = express.Router();

const DEFAULT_STORAGE_QUOTA_BYTES = Number(
  process.env.DEFAULT_STORAGE_QUOTA_BYTES || 1073741824
);

const DEFAULT_BANDWIDTH_QUOTA_BYTES = Number(
  process.env.DEFAULT_BANDWIDTH_QUOTA_BYTES || 10737418240
);

const SLUG_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

function parseQuota(value, fallback) {
  const parsed = Number(
    value === undefined ? fallback : value
  );

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

/*
 * POST /api/tenants
 * Yeni tenant + quota + API key oluşturur.
 */
router.post("/", async (req, res, next) => {
  const {
    name,
    slug,
    storageQuotaBytes,
    bandwidthQuotaBytes,
  } = req.body;

  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 120
  ) {
    return res.status(400).json({
      error:
        "name must be between 2 and 120 characters",
    });
  }

  if (
    typeof slug !== "string" ||
    !SLUG_REGEX.test(slug)
  ) {
    return res.status(400).json({
      error:
        "slug must contain lowercase letters, numbers or hyphens and be 3-63 characters",
    });
  }

  const storageLimit = parseQuota(
    storageQuotaBytes,
    DEFAULT_STORAGE_QUOTA_BYTES
  );

  const bandwidthLimit = parseQuota(
    bandwidthQuotaBytes,
    DEFAULT_BANDWIDTH_QUOTA_BYTES
  );

  if (
    storageLimit === null ||
    bandwidthLimit === null
  ) {
    return res.status(400).json({
      error:
        "quota values must be non-negative integers",
    });
  }

  const tenantId = randomUUID();

  const bucketName = `tenant-${tenantId}`;

  const apiKeyId = randomUUID();

  const {
    apiKey,
    keyHash,
    keyPrefix,
  } = generateApiKey();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `
        INSERT INTO tenants (
          id,
          name,
          slug,
          bucket_name
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          name,
          slug,
          bucket_name,
          status,
          created_at,
          updated_at
      `,
      [
        tenantId,
        name.trim(),
        slug,
        bucketName,
      ]
    );

    const quotaResult = await client.query(
      `
        INSERT INTO tenant_quotas (
          tenant_id,
          storage_limit_bytes,
          bandwidth_limit_bytes
        )
        VALUES ($1, $2, $3)
        RETURNING
          storage_limit_bytes,
          bandwidth_limit_bytes
      `,
      [
        tenantId,
        storageLimit,
        bandwidthLimit,
      ]
    );

    await client.query(
      `
        INSERT INTO api_keys (
          id,
          tenant_id,
          key_prefix,
          key_hash
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        apiKeyId,
        tenantId,
        keyPrefix,
        keyHash,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Tenant created successfully",
      tenant: {
        ...tenantResult.rows[0],
        ...quotaResult.rows[0],
      },
      apiKey,
      apiKeyWarning:
        "This API key is shown only once. Store it securely.",
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({
        error:
          "Tenant slug or bucket already exists",
      });
    }

    next(err);
  } finally {
    client.release();
  }
});

/*
 * GET /api/tenants
 * Tüm tenant'ları listeler.
 */
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.bucket_name,
        t.status,
        q.storage_limit_bytes,
        q.bandwidth_limit_bytes,
        t.created_at,
        t.updated_at
      FROM tenants t
      INNER JOIN tenant_quotas q
        ON q.tenant_id = t.id
      ORDER BY t.created_at DESC
    `);

    res.json({
      count: result.rowCount,
      tenants: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

/*
 * GET /api/tenants/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT
          t.id,
          t.name,
          t.slug,
          t.bucket_name,
          t.status,
          q.storage_limit_bytes,
          q.bandwidth_limit_bytes,
          t.created_at,
          t.updated_at
        FROM tenants t
        INNER JOIN tenant_quotas q
          ON q.tenant_id = t.id
        WHERE t.id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    res.json({
      tenant: result.rows[0],
    });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        error: "Invalid tenant id",
      });
    }

    next(err);
  }
});

/*
 * PUT /api/tenants/:id
 */
router.put("/:id", async (req, res, next) => {
  const {
    name,
    slug,
    status,
    storageQuotaBytes,
    bandwidthQuotaBytes,
  } = req.body;

  if (
    name !== undefined &&
    (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 120
    )
  ) {
    return res.status(400).json({
      error: "Invalid name",
    });
  }

  if (
    slug !== undefined &&
    (
      typeof slug !== "string" ||
      !SLUG_REGEX.test(slug)
    )
  ) {
    return res.status(400).json({
      error: "Invalid slug",
    });
  }

  if (
    status !== undefined &&
    !["active", "suspended"].includes(status)
  ) {
    return res.status(400).json({
      error:
        "status must be active or suspended",
    });
  }

  let storageLimit = null;
  let bandwidthLimit = null;

  if (storageQuotaBytes !== undefined) {
    storageLimit = parseQuota(
      storageQuotaBytes,
      0
    );

    if (storageLimit === null) {
      return res.status(400).json({
        error: "Invalid storage quota",
      });
    }
  }

  if (bandwidthQuotaBytes !== undefined) {
    bandwidthLimit = parseQuota(
      bandwidthQuotaBytes,
      0
    );

    if (bandwidthLimit === null) {
      return res.status(400).json({
        error: "Invalid bandwidth quota",
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `
        UPDATE tenants
        SET
          name = COALESCE($2, name),
          slug = COALESCE($3, slug),
          status = COALESCE($4, status),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          name,
          slug,
          bucket_name,
          status,
          created_at,
          updated_at
      `,
      [
        req.params.id,
        name === undefined ? null : name.trim(),
        slug === undefined ? null : slug,
        status === undefined ? null : status,
      ]
    );

    if (tenantResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    const quotaResult = await client.query(
      `
        UPDATE tenant_quotas
        SET
          storage_limit_bytes =
            COALESCE($2, storage_limit_bytes),

          bandwidth_limit_bytes =
            COALESCE($3, bandwidth_limit_bytes),

          updated_at = NOW()

        WHERE tenant_id = $1

        RETURNING
          storage_limit_bytes,
          bandwidth_limit_bytes
      `,
      [
        req.params.id,
        storageLimit,
        bandwidthLimit,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Tenant updated successfully",
      tenant: {
        ...tenantResult.rows[0],
        ...quotaResult.rows[0],
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({
        error: "Tenant slug already exists",
      });
    }

    if (err.code === "22P02") {
      return res.status(400).json({
        error: "Invalid tenant id",
      });
    }

    next(err);
  } finally {
    client.release();
  }
});

/*
 * DELETE /api/tenants/:id
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        DELETE FROM tenants
        WHERE id = $1
        RETURNING id
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    res.status(204).end();
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        error: "Invalid tenant id",
      });
    }

    next(err);
  }
});

module.exports = router;
