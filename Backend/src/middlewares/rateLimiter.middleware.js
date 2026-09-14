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
