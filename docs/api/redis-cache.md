# Redis CDN Cache

## Overview

The CDN serving layer uses Redis as a tenant-isolated
hot-path cache with the cache-aside pattern.

Cache key format:

`cdn:<tenant_id>:<object_path>`

Example:

`cdn:1eb5555c-8d24-47ed-a8e6-178dacac90fb:cache/cache-demo.txt`

## Cache-Aside Flow

1. Authenticate tenant.
2. Build tenant-prefixed Redis key.
3. Check Redis.
4. On HIT, serve cached body and metadata.
5. On MISS, read the object from MinIO.
6. Store body and metadata in Redis with TTL.
7. Serve the object to the client.

Cached metadata includes:

- Content-Type
- Content-Length
- ETag
- Last-Modified
- Object body

## TTL

Configuration:

`CACHE_TTL_SECONDS`

Development default:

`60`

Redis automatically removes the cache entry after
the configured TTL expires.

## Response Header

CDN responses include:

`X-Cache: HIT`

or:

`X-Cache: MISS`

`X-Cache: BYPASS` may be returned when Redis cannot
be read and MinIO is used directly.

## Upload / Overwrite Invalidation

Endpoint:

`POST /api/upload`

When an object is successfully uploaded to a path,
the corresponding tenant-prefixed Redis cache key
is deleted.

This prevents stale cached content from being served
after an overwrite.

## Delete Object

Endpoint:

`DELETE /api/upload/<object-path>`

Example:

`DELETE /api/upload/cache/cache-demo.txt`

The authenticated tenant is derived from the API key.
The client cannot choose another tenant or bucket.

After the MinIO object is deleted, the matching Redis
cache key is invalidated.

## HTTP Cache Compatibility

Redis caching does not replace HTTP caching.

The CDN endpoint continues to support:

- Cache-Control
- ETag
- Last-Modified
- If-None-Match
- If-Modified-Since
- 304 Not Modified

Conditional requests are evaluated using metadata
stored with the cached object.
