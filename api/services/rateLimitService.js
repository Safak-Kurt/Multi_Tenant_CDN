const {
  randomUUID
} = require("node:crypto");

const {
  getRedisClient
} = require("./redisService");

const RATE_LIMIT_WINDOW_SECONDS =
  Number.parseInt(
    process.env.RATE_LIMIT_WINDOW_SECONDS ||
      "60",
    10
  );

const RATE_LIMIT_MAX_REQUESTS =
  Number.parseInt(
    process.env.RATE_LIMIT_MAX_REQUESTS ||
      "10",
    10
  );

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]

local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local window_start =
  now - window_ms

redis.call(
  "ZREMRANGEBYSCORE",
  key,
  "-inf",
  window_start
)

local current =
  redis.call("ZCARD", key)

if current >= limit then
  local oldest =
    redis.call(
      "ZRANGE",
      key,
      0,
      0,
      "WITHSCORES"
    )

  local retry_after = 1

  if #oldest >= 2 then
    retry_after =
      math.ceil(
        (
          tonumber(oldest[2])
          + window_ms
          - now
        ) / 1000
      )

    if retry_after < 1 then
      retry_after = 1
    end
  end

  return {
    0,
    current,
    retry_after
  }
end

redis.call(
  "ZADD",
  key,
  now,
  member
)

local new_count =
  current + 1

redis.call(
  "PEXPIRE",
  key,
  window_ms
)

return {
  1,
  new_count,
  0
}
`;

function buildRateLimitKey(
  tenantId,
  scope = "cdn"
) {
  return `ratelimit:${tenantId}:${scope}`;
}

async function checkRateLimit({
  tenantId,
  scope = "cdn",
  limit = RATE_LIMIT_MAX_REQUESTS,
  windowSeconds =
    RATE_LIMIT_WINDOW_SECONDS
}) {
  if (!tenantId) {
    throw new Error(
      "tenantId is required for rate limiting"
    );
  }

  const redis =
    await getRedisClient();

  const key =
    buildRateLimitKey(
      tenantId,
      scope
    );

  const now =
    Date.now();

  const windowMs =
    windowSeconds * 1000;

  const member =
    `${now}:${randomUUID()}`;

  const result =
    await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      {
        keys: [key],
        arguments: [
          String(now),
          String(windowMs),
          String(limit),
          member
        ]
      }
    );

  const allowed =
    Number(result[0]) === 1;

  const count =
    Number(result[1]);

  const retryAfterSeconds =
    Number(result[2]);

  return {
    allowed,
    key,
    count,
    limit,
    remaining:
      Math.max(0, limit - count),
    windowSeconds,
    retryAfterSeconds
  };
}

module.exports = {
  buildRateLimitKey,
  checkRateLimit,
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_MAX_REQUESTS
};
