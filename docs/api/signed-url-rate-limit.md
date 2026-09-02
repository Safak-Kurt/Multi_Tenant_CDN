# Signed URL and Tenant Rate Limiting

## Overview

Day 6 introduces two security and traffic-control mechanisms:

1. Time-limited HMAC-SHA256 signed URLs for private CDN content.
2. Tenant-scoped Redis Sliding Window rate limiting.

These mechanisms allow private CDN objects to be accessed securely without exposing tenant API keys, while also preventing individual tenants from generating excessive traffic.

---

## Signed URL

### Create a Signed URL

A signed URL is generated through the following authenticated endpoint:

```http
POST /api/signed-urls
```

### Authentication

The request requires the tenant API key:

```http
X-API-Key: <tenant-api-key>
```

The request must also be sent using the Host/subdomain associated with the authenticated tenant.

### Example Request Body

```json
{
  "objectPath": "cache/cache-demo.txt",
  "expiresInSeconds": 60
}
```

`objectPath` identifies the object inside the authenticated tenant's MinIO bucket.

`expiresInSeconds` defines how long the generated signed URL remains valid.

### Example Response

```json
{
  "tenant": {
    "id": "<tenant-id>",
    "slug": "acme-demo"
  },
  "objectPath": "cache/cache-demo.txt",
  "expires": 0,
  "expiresAt": "<iso-date>",
  "url": "http://acme-demo.cdn.test/cdn/cache/cache-demo.txt?expires=...&signature=..."
}
```

The generated URL contains an expiration timestamp and cryptographic signature.

---

## Signed URL Access

The generated signed URL can be used to access the CDN object without sending the tenant API key.

Example request structure:

```http
GET /cdn/<object-path>?expires=<unix>&signature=<hmac>
```

Example:

```text
http://acme-demo.cdn.test/cdn/cache/cache-demo.txt?expires=<unix>&signature=<hmac>
```

The CDN authorization layer validates the signed URL before allowing access to the object.

### Signed Values

Signed URL verification binds the following values to the generated signature:

```text
HTTP method
tenant ID
object path
expiration timestamp
```

This prevents a valid signature generated for one tenant, object path, HTTP method, or expiration time from being reused for a different request.

### Signature Algorithm

The project uses:

```text
HMAC-SHA256
```

The server generates the signature using a secret value that is not exposed to the client.

---

## Signed URL Validation

A signed URL is rejected when any of the following conditions occur:

```text
signature is missing
signature is invalid
URL is expired
tenant host is invalid
tenant is inactive
```

Invalid or expired signed URLs return:

```http
HTTP/1.1 403 Forbidden
```

A valid signed URL allows the request to continue through the normal CDN serving pipeline.

---

## Tenant Rate Limiting

CDN requests are protected by a tenant-scoped Redis Sliding Window rate limiter.

Each tenant receives an independent request window and counter. Therefore, one tenant consuming its request allowance does not consume the allowance of another tenant.

### Development Configuration

Current development configuration:

```text
Window: 60 seconds
Limit: 10 requests
```

This means a tenant can make up to 10 requests within the active 60-second sliding window.

When the request limit is exceeded, additional requests are temporarily blocked until enough requests leave the active window.

---

## Redis Rate-Limit Key

Rate-limit information is stored in Redis using the following key format:

```text
ratelimit:<tenant_id>:cdn
```

Example:

```text
ratelimit:1eb5555c-8d24-47ed-a8e6-178dacac90fb:cdn
```

Including the tenant ID in the Redis key provides tenant-level rate-limit isolation.

---

## Redis Data Structure

The rate limiter uses a Redis:

```text
Sorted Set (ZSET)
```

Each request is represented using its timestamp as the Sorted Set score.

Conceptually:

```text
ratelimit:<tenant_id>:cdn
        |
        +-- request timestamp
        +-- request timestamp
        +-- request timestamp
        +-- ...
```

Before the current request is counted, request records outside the active sliding window are removed.

The remaining entries therefore represent requests that are still inside the current rate-limit window.

---

## Atomic Rate-Limit Check

The Sliding Window operations are executed atomically using a Redis Lua script.

The rate-limit operation performs the following logical steps:

```text
Remove expired request records
        |
        v
Count requests in active window
        |
        v
Check configured tenant limit
        |
        +-- Limit exceeded -> BLOCK
        |
        +-- Limit available -> ALLOW
                              |
                              v
                       Store current request
```

Executing these operations atomically prevents inconsistent request counts when multiple requests arrive concurrently.

---

## Rate-Limit Response Headers

Successful CDN responses include rate-limit information through HTTP response headers:

```http
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Window
```

These headers allow the client to determine the configured request limit, remaining request allowance, and active window duration.

When the limit is exceeded, the API returns:

```http
HTTP/1.1 429 Too Many Requests
```

The response also includes:

```http
Retry-After
```

`Retry-After` indicates how long the client should wait before retrying the request.

---

## Request Flow

The combined Signed URL and tenant rate-limiting request flow is:

```text
Client
  |
  v
Nginx
  |
  v
CDN Authorization
  |
  +-- API Key
  |
  +-- Signed URL
  |
  v
req.tenant
  |
  v
Tenant Rate Limiter
  |
  v
Redis Sliding Window
  |
  +-- BLOCK
  |     |
  |     v
  |   429 Too Many Requests
  |
  +-- ALLOW
        |
        v
Redis CDN Cache
        |
        +-- HIT
        |     |
        |     v
        |   Cached Response
        |
        +-- MISS
              |
              v
            MinIO
              |
              v
        Cache + Response
```

Both API-key authenticated requests and valid signed URL requests are associated with a tenant before the rate limiter is executed.

This allows the same tenant-level traffic policy to be applied regardless of which supported authorization mechanism is used.

---

## Redis Namespaces

CDN object caching and rate limiting use intentionally separate Redis namespaces.

### CDN Cache

```text
cdn:<tenant_id>:<object_path>
```

Example:

```text
cdn:1eb5555c-8d24-47ed-a8e6-178dacac90fb:cache/cache-demo.txt
```

### Rate Limiting

```text
ratelimit:<tenant_id>:cdn
```

Example:

```text
ratelimit:1eb5555c-8d24-47ed-a8e6-178dacac90fb:cdn
```

The namespaces are intentionally separated because CDN cache data and rate-limit state serve different purposes and have different lifecycle requirements.

---

## Tenant Isolation

Both Signed URL authorization and rate limiting operate using the authenticated or resolved tenant identity.

The tenant information is attached to the Express request through:

```javascript
req.tenant
```

Tenant-specific values such as the tenant ID are then used for:

```text
MinIO bucket selection
Redis CDN cache keys
Redis rate-limit keys
Signed URL validation
```

This ensures that one tenant's CDN objects, cache entries, and rate-limit state remain logically isolated from those of other tenants.

---

## Security Notes

- Signed URL secrets are stored through environment variables and are not committed to Git.
- Signed URLs expire automatically according to their configured expiration timestamp.
- A signature is bound to a tenant ID and object path.
- The HTTP method and expiration timestamp are also included in signature validation.
- Signature comparison uses constant-time comparison.
- Modified object paths invalidate the original signed URL signature.
- Expired signed URLs are rejected with `403 Forbidden`.
- Rate-limit counters are isolated per tenant.
- Redis Sliding Window operations are executed atomically using a Lua script.
- Signed URL requests are also subject to tenant rate limiting.
- CDN cache keys and rate-limit keys use separate Redis namespaces.
