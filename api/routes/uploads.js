const express = require("express");
const multer = require("multer");

const {
  authenticateTenant,
} = require("../middleware/auth");

const {
  minioClient,
  ensureTenantBucket,
} = require("../services/minioService");

const router = express.Router();

const parsedMaxUploadBytes = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES || "10485760",
  10
);

const MAX_UPLOAD_BYTES =
  Number.isFinite(parsedMaxUploadBytes) &&
  parsedMaxUploadBytes > 0
    ? parsedMaxUploadBytes
    : 10485760;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 5,
  },
});

function buildObjectName(req, file) {
  const requestedPath =
    req.body?.path || file.originalname || "";

  const normalized = String(requestedPath)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!normalized) {
    throw new Error("Object path cannot be empty");
  }

  if (normalized.includes("\0")) {
    throw new Error("Invalid object path");
  }

  const segments = normalized
    .split("/")
    .filter(Boolean);

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "." || segment === ".."
    )
  ) {
    throw new Error("Invalid object path");
  }

  return segments.join("/");
}

function hasForbiddenTenantSelector(body = {}) {
  const forbiddenFields = [
    "tenantId",
    "tenant_id",
    "bucket",
    "bucketName",
    "bucket_name",
  ];

  return forbiddenFields.some(
    (field) =>
      body[field] !== undefined &&
      body[field] !== ""
  );
}

const singleFileUpload = upload.single("file");

router.post(
  "/",
  authenticateTenant,
  (req, res, next) => {
    singleFileUpload(req, res, async (uploadError) => {
      if (uploadError instanceof multer.MulterError) {
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: "Uploaded file exceeds maximum size",
            maxUploadBytes: MAX_UPLOAD_BYTES,
          });
        }

        return res.status(400).json({
          error: uploadError.message,
        });
      }

      if (uploadError) {
        return next(uploadError);
      }

      try {
        if (hasForbiddenTenantSelector(req.body)) {
          return res.status(400).json({
            error:
              "Tenant and bucket are derived from the authenticated API key",
          });
        }

        if (!req.file) {
          return res.status(400).json({
            error:
              "A file must be provided in the 'file' form field",
          });
        }

        let objectName;

        try {
          objectName = buildObjectName(
            req,
            req.file
          );
        } catch (error) {
          return res.status(400).json({
            error: error.message,
          });
        }

        const bucketName =
          req.tenant.bucketName;

        await ensureTenantBucket(bucketName);

        const uploadResult =
          await minioClient.putObject(
            bucketName,
            objectName,
            req.file.buffer,
            req.file.size,
            {
              "Content-Type":
                req.file.mimetype ||
                "application/octet-stream",
              "X-Amz-Meta-Tenant-Id":
                req.tenant.id,
            }
          );

        return res.status(201).json({
          message: "File uploaded successfully",
          tenant: {
            id: req.tenant.id,
            slug: req.tenant.slug,
          },
          object: {
            bucket: bucketName,
            key: objectName,
            size: req.file.size,
            contentType:
              req.file.mimetype ||
              "application/octet-stream",
            etag:
              typeof uploadResult === "string"
                ? uploadResult
                : uploadResult?.etag || null,
          },
        });
      } catch (error) {
        next(error);
      }
    });
  }
);

module.exports = router;
