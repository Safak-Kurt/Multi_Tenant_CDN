const path = require("node:path");
const { minioClient } = require("./minioService");

const MIME_TYPES = {
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4"
};

function resolveContentType(objectPath, metaData = {}) {
  const storedContentType =
    metaData["content-type"] ||
    metaData["Content-Type"];

  if (storedContentType) {
    return storedContentType;
  }

  const extension = path.extname(objectPath).toLowerCase();

  return MIME_TYPES[extension] || "application/octet-stream";
}

async function statTenantObject(bucketName, objectPath) {
  return minioClient.statObject(bucketName, objectPath);
}

async function getTenantObjectStream(bucketName, objectPath) {
  return minioClient.getObject(bucketName, objectPath);
}

function isMinioNotFoundError(error) {
  return [
    "NoSuchKey",
    "NoSuchObject",
    "NoSuchBucket",
    "NotFound"
  ].includes(error?.code);
}

module.exports = {
  resolveContentType,
  statTenantObject,
  getTenantObjectStream,
  isMinioNotFoundError
};
