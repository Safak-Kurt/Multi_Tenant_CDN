const {
  checkRateLimit
} = require(
  "../services/rateLimitService"
);

async function tenantRateLimit(
  req,
  res,
  next
) {
  if (
    !req.tenant ||
    !req.tenant.id
  ) {
    return res.status(500).json({
      error:
        "Tenant context is required for rate limiting"
    });
  }

  try {
    const result =
      await checkRateLimit({
        tenantId:
          req.tenant.id,
        scope: "cdn"
      });

    res.setHeader(
      "X-RateLimit-Limit",
      String(result.limit)
    );

    res.setHeader(
      "X-RateLimit-Remaining",
      String(result.remaining)
    );

    res.setHeader(
      "X-RateLimit-Window",
      String(result.windowSeconds)
    );

    if (!result.allowed) {
      res.setHeader(
        "Retry-After",
        String(
          result.retryAfterSeconds
        )
      );

      console.log(
        `[RateLimit] BLOCK tenant=${req.tenant.id}` +
        ` count=${result.count}` +
        ` limit=${result.limit}`
      );

      return res.status(429).json({
        error:
          "Too Many Requests",
        tenantId:
          req.tenant.id,
        limit:
          result.limit,
        windowSeconds:
          result.windowSeconds,
        retryAfterSeconds:
          result.retryAfterSeconds
      });
    }

    console.log(
      `[RateLimit] ALLOW tenant=${req.tenant.id}` +
      ` count=${result.count}` +
      ` remaining=${result.remaining}`
    );

    return next();
  } catch (error) {
    console.error(
      "[RateLimit] Redis unavailable, bypassing:",
      error.message
    );

    res.setHeader(
      "X-RateLimit-Status",
      "BYPASS"
    );

    return next();
  }
}

module.exports = {
  tenantRateLimit
};
