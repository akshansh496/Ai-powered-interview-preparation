const { createClient } = require("redis");

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => {
    console.error("Redis Client Error:", err);
});

redisClient.on("connect", () => {
    console.log("Redis connecting...");
});

redisClient.on("ready", () => {
    console.log("Redis connected and ready");
});

redisClient.on("reconnecting", () => {
    console.log("Redis reconnecting...");
});

async function connectRedis() {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}

connectRedis().catch((error) => {
    console.error("Failed to connect to Redis:", error.message);
});

module.exports = redisClient;