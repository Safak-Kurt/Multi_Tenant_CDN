const express = require("express");
const { Transform } = require("node:stream");

const { authorizeCdnRequest } = require("../middleware/cdnAuthorization");

const {
  resolveContentType,
  statTenantObject,
  getTenantObjectStream,
  isMinioNotFoundError
} = require("../services/cdnService");

const {
  CACHE_TTL_SECONDS,
  buildCdnCacheKey,
  getCachedObject,
  setCachedObject
} = require("../services/cacheService");

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

function setRepresentationHeaders(
  res,
  {
    contentType,
    etag,
    lastModified,
    cacheStatus
  }
) {
  res.set({
    "Content-Type": contentType,
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Last-Modified": lastModified.toUTCString(),
    Vary: "X-API-Key",
    "X-Cache": cacheStatus
  });
}

function isNotModifiedRequest(
  req,
  etag,
  lastModified
) {
  const ifNoneMatch = req.get("If-None-Match");

  if (
    ifNoneMatch &&
    matchesIfNoneMatch(
      ifNoneMatch,
      etag
    )
  ) {
    return true;
  }

  const ifModifiedSince =
    req.get("If-Modified-Since");

  return (
    !ifNoneMatch &&
    ifModifiedSince &&
    notModifiedSince(
      ifModifiedSince,
      lastModified
    )
  );
}

router.get(
  "/*objectPath",
  authorizeCdnRequest,
  async (req, res, next) => {
    const objectPath = buildObjectPath(
      req.params.objectPath
    );

    if (!objectPath) {
      return res.status(400).json({
        error: "Invalid object path"
      });
    }

    const tenantId = req.tenant.id;
    const bucketName = req.tenant.bucketName;

    const cacheKey = buildCdnCacheKey(
      tenantId,
      objectPath
    );

    try {
      let cachedObject = null;
      let cacheReadAvailable = true;

      try {
        const cached = await getCachedObject(
          tenantId,
          objectPath
        );

        cachedObject = cached.object;
      } catch (cacheError) {
        cacheReadAvailable = false;

        console.error(
          `[Cache] READ ERROR ${cacheKey}:`,
          cacheError.message
        );
      }

      if (cachedObject) {
        console.log(
          `[Cache] HIT ${cacheKey}`
        );

        setRepresentationHeaders(
          res,
          {
            contentType:
              cachedObject.contentType,
            etag:
              cachedObject.etag,
            lastModified:
              cachedObject.lastModified,
            cacheStatus: "HIT"
          }
        );

        if (
          isNotModifiedRequest(
            req,
            cachedObject.etag,
            cachedObject.lastModified
          )
        ) {
          return res.status(304).end();
        }

        res.set(
          "Content-Length",
          String(cachedObject.size)
        );

        return res
          .status(200)
          .send(cachedObject.body);
      }

      const cacheStatus =
        cacheReadAvailable
          ? "MISS"
          : "BYPASS";

      console.log(
        `[Cache] ${cacheStatus} ${cacheKey}`
      );

      const stat = await statTenantObject(
        bucketName,
        objectPath
      );

      const contentType =
        resolveContentType(
          objectPath,
          stat.metaData
        );

      const etag =
        formatETag(stat.etag);

      const lastModified =
        new Date(stat.lastModified);

      setRepresentationHeaders(
        res,
        {
          contentType,
          etag,
          lastModified,
          cacheStatus
        }
      );

      if (
        isNotModifiedRequest(
          req,
          etag,
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

      const chunks = [];

      const cacheTee = new Transform({
        transform(
          chunk,
          encoding,
          callback
        ) {
          const bufferChunk =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(
                  chunk,
                  encoding
                );

          chunks.push(bufferChunk);

          callback(
            null,
            bufferChunk
          );
        },

        flush(callback) {
          const body =
            Buffer.concat(chunks);

          setCachedObject(
            tenantId,
            objectPath,
            {
              body,
              size: stat.size,
              contentType,
              etag,
              lastModified
            }
          )
            .then(() => {
              console.log(
                `[Cache] STORE ${cacheKey} ttl=${CACHE_TTL_SECONDS}s`
              );
            })
            .catch((cacheError) => {
              console.error(
                `[Cache] STORE ERROR ${cacheKey}:`,
                cacheError.message
              );
            })
            .finally(() => {
              callback();
            });
        }
      });

      objectStream.on(
        "error",
        (error) => {
          cacheTee.destroy(error);
        }
      );

      cacheTee.on(
        "error",
        (error) => {
          if (!res.headersSent) {
            return next(error);
          }

          res.destroy(error);
        }
      );

      objectStream
        .pipe(cacheTee)
        .pipe(res);
    } catch (error) {
      if (
        isMinioNotFoundError(error)
      ) {
        return res.status(404).json({
          error: "Object not found",
          objectPath
        });
      }

      if (res.headersSent) {
        return res.destroy(error);
      }

      next(error);
    }
  }
);

module.exports = router;
