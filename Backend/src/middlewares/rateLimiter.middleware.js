const redisClient = require("../config/redis")
const jwt = require("jsonwebtoken")

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_REQUESTS = 10;
const RATE_LIMIT_KEY_PREFIX = "rate_limit:";
const RATE_LIMIT_WINDOW_KEY_PREFIX = "rate_limit_window:";

const getClientKey = (req) => {
    const userId = req.user?.id || req.user?._id;
    if (userId) return `${RATE_LIMIT_KEY_PREFIX}${userId}`;
    return `${RATE_LIMIT_KEY_PREFIX}${req.ip}`;
};

const getWindowKey = (req) => {
    const userId = req.user?.id || req.user?._id;
    if (userId) return `${RATE_LIMIT_WINDOW_KEY_PREFIX}${userId}`;
    return `${RATE_LIMIT_WINDOW_KEY_PREFIX}${req.ip}`;
};

async function checkRateLimit(req, res, next) {
    try {
        if (!redisClient || !redisClient.isReady) {
            console.warn("Redis not available, proceeding without rate limiting");
            return next();
        }

        const windowMs = parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 10) || DEFAULT_WINDOW_MS;
        const maxRequests = parseInt(process.env.AI_REQUEST_LIMIT_PER_WINDOW, 10) || DEFAULT_MAX_REQUESTS;

        const clientKey = getClientKey(req);
        const windowKey = getWindowKey(req);

        const windowStartTime = await redisClient.get(windowKey);
        const now = Date.now();

        let currentWindowStart = windowStartTime;

        if (!windowStartTime) {
            currentWindowStart = now.toString();
            // Set window start time for 1 hour (longer duration to prevent constant resets)
            // This effectively creates "hourly buckets" for rate limiting
            await redisClient.setEx(windowKey, 3600, currentWindowStart);
        }

        const clientRequestsCount = await redisClient.incr(clientKey);
        const timeWindowInMs = now - parseInt(currentWindowStart, 10);

        // Reset if we've moved to the next time window
        // This effectively resets the counter every hour, which is more efficient
        // than a sliding 15-minute window and prevents frequent resets
        if (timeWindowInMs > windowMs) {
            await redisClient.setEx(windowKey, 3600, now.toString());
            await redisClient.setEx(clientKey, windowMs, 1);
            next();
            return;
        }

        if (clientRequestsCount > maxRequests) {
            const retryAfter = Math.ceil((parseInt(currentWindowStart, 10) + windowMs - now) / 1000);

            res.set("Retry-After", retryAfter.toString());
            return res.status(429).json({
                success: false,
                message: "Too many requests. Please try again later.",
                retryAfter,
            });
        }

        // Set expiry for the client key based on window duration
        await redisClient.expire(clientKey, Math.ceil(windowMs / 1000));

        next();
    } catch (error) {
        console.error("Rate limiting error:", error);
        // If rate limiting fails, proceed without rate limiting
        next();
    }
}

// Export rate limiting for use in AI endpoints
module.exports = {
    checkRateLimit,
}

/**
 * In-memory sliding window rate limiter middleware for expensive AI endpoints.
 * Operates without Redis or external distributed infrastructure.
 */

function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 10) || (15 * 60 * 1000) // 15 mins default
    const maxRequests = options.maxRequests || parseInt(process.env.AI_REQUEST_LIMIT_PER_WINDOW, 10) || 10 // 10 requests default
    const message = options.message || "Too many AI generation requests. Please wait a few minutes before trying again."

    // Map: clientIdentifier -> Array of timestamp numbers
    const requestsMap = new Map()

    // Periodically clean up stale clients every 5 minutes to prevent memory leaks
    const cleanupInterval = setInterval(() => {
        const now = Date.now()
        for (const [key, timestamps] of requestsMap.entries()) {
            const valid = timestamps.filter(time => now - time < windowMs)
            if (valid.length === 0) {
                requestsMap.delete(key)
            } else {
                requestsMap.set(key, valid)
            }
        }
    }, 5 * 60 * 1000)

    if (cleanupInterval.unref) {
        cleanupInterval.unref()
    }

    const rateLimiterMiddleware = (req, res, next) => {
        const key = (req.user && (req.user.id || req.user._id)) || req.ip || "unknown"
        const now = Date.now()

        const timestamps = requestsMap.get(key) || []
        // Remove timestamps outside the sliding window
        const validTimestamps = timestamps.filter(time => now - time < windowMs)

        if (validTimestamps.length >= maxRequests) {
            const oldest = validTimestamps[0]
            const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))

            res.set("Retry-After", String(retryAfterSeconds))
            res.set("X-RateLimit-Limit", String(maxRequests))
            res.set("X-RateLimit-Remaining", "0")
            res.set("X-RateLimit-Reset", String(Math.ceil((oldest + windowMs) / 1000)))

            return res.status(429).json({
                message,
                retryAfter: retryAfterSeconds
            })
        }

        validTimestamps.push(now)
        requestsMap.set(key, validTimestamps)

        res.set("X-RateLimit-Limit", String(maxRequests))
        res.set("X-RateLimit-Remaining", String(maxRequests - validTimestamps.length))

        next()
    }

    // Helper for testing to clear state
    rateLimiterMiddleware.reset = () => {
        requestsMap.clear()
    }

    return rateLimiterMiddleware
}

const aiEndpointRateLimiter = createRateLimiter()

module.exports = {
    createRateLimiter,
    aiEndpointRateLimiter
}
