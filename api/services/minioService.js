const Minio = require("minio");

function parseMinioEndpoint(value) {
  const rawValue = value || "minio:9000";

  const normalizedValue =
    /^[a-z]+:\/\//i.test(rawValue)
      ? rawValue
      : `http://${rawValue}`;

  const url = new URL(normalizedValue);

  let port = Number(
    url.port ||
      (url.protocol === "https:" ? 443 : 9000)
  );

  let useSSL = url.protocol === "https:";

  if (process.env.MINIO_PORT) {
    port = Number(process.env.MINIO_PORT);
  }

  if (process.env.MINIO_USE_SSL !== undefined) {
    useSSL =
      process.env.MINIO_USE_SSL.toLowerCase() === "true";
  }

  return {
    endPoint: url.hostname,
    port,
    useSSL,
  };
}

const endpoint = parseMinioEndpoint(
  process.env.MINIO_ENDPOINT
);

const accessKey = process.env.MINIO_ACCESS_KEY;
const secretKey = process.env.MINIO_SECRET_KEY;

if (!accessKey || !secretKey) {
  throw new Error(
    "MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be configured"
  );
}

const minioClient = new Minio.Client({
  endPoint: endpoint.endPoint,
  port: endpoint.port,
  useSSL: endpoint.useSSL,
  accessKey,
  secretKey,
});

async function ensureTenantBucket(bucketName) {
  const exists =
    await minioClient.bucketExists(bucketName);

  if (!exists) {
    await minioClient.makeBucket(bucketName);
  }

  return bucketName;
}

module.exports = {
  minioClient,
  ensureTenantBucket,
};
