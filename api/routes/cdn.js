const express = require("express");

const { authenticateTenant } = require("../middleware/auth");

const {
  resolveContentType,
  statTenantObject,
  getTenantObjectStream,
  isMinioNotFoundError
} = require("../services/cdnService");

const router = express.Router();

function buildObjectPath(value) {
  const segments = Array.isArray(value) ? value : [value];

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".."
    )
  ) {
    return null;
  }

  return segments.join("/");
}

function formatETag(value) {
  const raw = String(value || "")
    .replace(/^W\//, "")
    .replace(/^"+|"+$/g, "");

  return `"${raw}"`;
}

function matchesIfNoneMatch(ifNoneMatch, currentETag) {
  if (!ifNoneMatch) {
    return false;
  }

  const normalizedCurrent = currentETag.replace(/^W\//, "");

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((candidate) => {
      if (candidate === "*") {
        return true;
      }

      return candidate.replace(/^W\//, "") === normalizedCurrent;
    });
}

function notModifiedSince(ifModifiedSince, lastModified) {
  if (!ifModifiedSince) {
    return false;
  }

  const requestTimestamp = Date.parse(ifModifiedSince);

  if (Number.isNaN(requestTimestamp)) {
    return false;
  }

  const objectSeconds = Math.floor(
    lastModified.getTime() / 1000
  );

  const requestSeconds = Math.floor(
    requestTimestamp / 1000
  );

  return objectSeconds <= requestSeconds;
}

router.get(
  "/*objectPath",
  authenticateTenant,
  async (req, res, next) => {
    const objectPath = buildObjectPath(
      req.params.objectPath
    );

    if (!objectPath) {
      return res.status(400).json({
        error: "Invalid object path"
      });
    }

    const bucketName = req.tenant.bucketName;

    try {
      const stat = await statTenantObject(
        bucketName,
        objectPath
      );

      const contentType = resolveContentType(
        objectPath,
        stat.metaData
      );

      const etag = formatETag(stat.etag);

      const lastModified = new Date(
        stat.lastModified
      );

      res.set({
        "Content-Type": contentType,
        "Cache-Control": "private, no-cache",
        ETag: etag,
        "Last-Modified": lastModified.toUTCString(),
        Vary: "X-API-Key"
      });

      const ifNoneMatch =
        req.get("If-None-Match");

      if (
        ifNoneMatch &&
        matchesIfNoneMatch(
          ifNoneMatch,
          etag
        )
      ) {
        return res.status(304).end();
      }

      const ifModifiedSince =
        req.get("If-Modified-Since");

      if (
        !ifNoneMatch &&
        ifModifiedSince &&
        notModifiedSince(
          ifModifiedSince,
          lastModified
        )
      ) {
        return res.status(304).end();
      }

      res.set(
        "Content-Length",
        String(stat.size)
      );

      const objectStream =
        await getTenantObjectStream(
          bucketName,
          objectPath
        );

      objectStream.on("error", (error) => {
        if (!res.headersSent) {
          return next(error);
        }

        res.destroy(error);
      });

      objectStream.pipe(res);
    } catch (error) {
      if (isMinioNotFoundError(error)) {
        return res.status(404).json({
          error: "Object not found",
          objectPath
        });
      }

      next(error);
    }
  }
);

module.exports = router;
