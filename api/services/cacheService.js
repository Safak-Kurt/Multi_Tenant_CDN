const {
  getRedisClient,
} = require("./redisService");

const parsedCacheTtl = Number.parseInt(
  process.env.CACHE_TTL_SECONDS || "60",
  10
);

const CACHE_TTL_SECONDS =
  Number.isFinite(parsedCacheTtl) &&
  parsedCacheTtl > 0
    ? parsedCacheTtl
    : 60;

function buildCdnCacheKey(
  tenantId,
  objectPath
) {
  return `cdn:${tenantId}:${objectPath}`;
}

function serializeCachedObject(object) {
  return JSON.stringify({
    bodyBase64:
      object.body.toString("base64"),
    size: object.size,
    contentType: object.contentType,
    etag: object.etag,
    lastModified:
      object.lastModified instanceof Date
        ? object.lastModified.toISOString()
        : new Date(
            object.lastModified
          ).toISOString(),
  });
}

function deserializeCachedObject(value) {
  const parsed = JSON.parse(value);

  return {
    body: Buffer.from(
      parsed.bodyBase64,
      "base64"
    ),
    size: Number(parsed.size),
    contentType: parsed.contentType,
    etag: parsed.etag,
    lastModified: new Date(
      parsed.lastModified
    ),
  };
}

async function getCachedObject(
  tenantId,
  objectPath
) {
  const redisClient =
    await getRedisClient();

  const cacheKey = buildCdnCacheKey(
    tenantId,
    objectPath
  );

  const value =
    await redisClient.get(cacheKey);

  if (value === null) {
    return {
      cacheKey,
      object: null,
    };
  }

  try {
    return {
      cacheKey,
      object:
        deserializeCachedObject(
          value
        ),
    };
  } catch (error) {
    console.error(
      `[Cache] Invalid cached value removed: ${cacheKey}`,
      error.message
    );

    await redisClient.del(cacheKey);

    return {
      cacheKey,
      object: null,
    };
  }
}

async function setCachedObject(
  tenantId,
  objectPath,
  object
) {
  const redisClient =
    await getRedisClient();

  const cacheKey = buildCdnCacheKey(
    tenantId,
    objectPath
  );

  const value =
    serializeCachedObject(object);

  await redisClient.set(
    cacheKey,
    value,
    {
      EX: CACHE_TTL_SECONDS,
    }
  );

  return cacheKey;
}

async function invalidateCachedObject(
  tenantId,
  objectPath
) {
  const redisClient =
    await getRedisClient();

  const cacheKey = buildCdnCacheKey(
    tenantId,
    objectPath
  );

  const deleted =
    await redisClient.del(cacheKey);

  return {
    cacheKey,
    deleted,
  };
}

async function getCachedObjectTtl(
  tenantId,
  objectPath
) {
  const redisClient =
    await getRedisClient();

  const cacheKey = buildCdnCacheKey(
    tenantId,
    objectPath
  );

  return redisClient.ttl(cacheKey);
}

module.exports = {
  CACHE_TTL_SECONDS,
  buildCdnCacheKey,
  getCachedObject,
  setCachedObject,
  invalidateCachedObject,
  getCachedObjectTtl,
};
