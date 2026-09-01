const { createClient } = require("redis");

const REDIS_URL =
  process.env.REDIS_URL || "redis://redis:6379";

const redisClient = createClient({
  url: REDIS_URL,
});

let connectionPromise = null;

redisClient.on("error", (error) => {
  console.error(
    "[Redis] Client error:",
    error.message
  );
});

async function getRedisClient() {
  if (redisClient.isReady) {
    return redisClient;
  }

  if (!connectionPromise) {
    connectionPromise = redisClient
      .connect()
      .then(() => {
        console.log(
          "[Redis] Connected successfully"
        );

        return redisClient;
      })
      .finally(() => {
        connectionPromise = null;
      });
  }

  return connectionPromise;
}

module.exports = {
  redisClient,
  getRedisClient,
};
