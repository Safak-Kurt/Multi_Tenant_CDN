const express = require("express");

const {
  authenticateTenant
} = require("../middleware/auth");

const {
  createSignedUrlData,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS
} = require("../services/signedUrlService");

const router = express.Router();

router.post(
  "/",
  authenticateTenant,
  (req, res) => {
    const {
      objectPath,
      expiresInSeconds
    } = req.body || {};

    if (
      typeof objectPath !== "string" ||
      !objectPath.trim()
    ) {
      return res.status(400).json({
        error: "objectPath is required"
      });
    }

    try {
      const signed = createSignedUrlData({
        tenantId: req.tenant.id,
        objectPath,
        expiresInSeconds:
          expiresInSeconds ??
          DEFAULT_TTL_SECONDS
      });

      const forwardedProto =
        req.headers["x-forwarded-proto"];

      const protocol =
        (
          Array.isArray(forwardedProto)
            ? forwardedProto[0]
            : forwardedProto
        )
          ?.split(",")[0]
          ?.trim() ||
        req.protocol ||
        "http";

      const forwardedHost =
        req.headers["x-forwarded-host"];

      const host =
        (
          Array.isArray(forwardedHost)
            ? forwardedHost[0]
            : forwardedHost
        )
          ?.split(",")[0]
          ?.trim() ||
        req.get("host");

      const encodedPath =
        signed.objectPath
          .split("/")
          .map(encodeURIComponent)
          .join("/");

      const query =
        new URLSearchParams({
          expires:
            String(signed.expires),
          signature:
            signed.signature
        });

      const url =
        `${protocol}://${host}` +
        `/cdn/${encodedPath}` +
        `?${query.toString()}`;

      return res.status(201).json({
        tenant: {
          id: req.tenant.id,
          slug: req.tenant.slug
        },
        objectPath:
          signed.objectPath,
        expires:
          signed.expires,
        expiresAt:
          new Date(
            signed.expires * 1000
          ).toISOString(),
        expiresInSeconds:
          expiresInSeconds ??
          DEFAULT_TTL_SECONDS,
        maxTtlSeconds:
          MAX_TTL_SECONDS,
        url
      });
    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }
  }
);

module.exports = router;
