const test = require("node:test")
const assert = require("node:assert/strict")
const { createRateLimiter } = require("../src/middlewares/rateLimiter.middleware")

test("Rate Limiter Middleware tests", async (t) => {

    await t.test("should allow requests under the configured threshold", () => {
        const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 3 })
        const req = { user: { id: "user-123" } }
        let nextCalled = 0
        const headers = {}
        const res = {
            set: (k, v) => { headers[k] = v },
            status: () => res,
            json: () => {}
        }

        const next = () => { nextCalled++ }

        // Request 1
        limiter(req, res, next)
        assert.equal(nextCalled, 1)
        assert.equal(headers["X-RateLimit-Remaining"], "2")

        // Request 2
        limiter(req, res, next)
        assert.equal(nextCalled, 2)
        assert.equal(headers["X-RateLimit-Remaining"], "1")

        // Request 3
        limiter(req, res, next)
        assert.equal(nextCalled, 3)
        assert.equal(headers["X-RateLimit-Remaining"], "0")
    })

    await t.test("should block and return 429 when requests exceed threshold", () => {
        const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 2 })
        const req = { user: { id: "user-456" } }
        let nextCalled = 0
        let statusCode = 200
        let jsonPayload = null
        const headers = {}

        const res = {
            set: (k, v) => { headers[k] = v },
            status: (code) => {
                statusCode = code
                return res
            },
            json: (payload) => {
                jsonPayload = payload
            }
        }

        const next = () => { nextCalled++ }

        // Allowed
        limiter(req, res, next)
        limiter(req, res, next)
        assert.equal(nextCalled, 2)

        // Blocked 3rd request
        limiter(req, res, next)
        assert.equal(nextCalled, 2) // next not called
        assert.equal(statusCode, 429)
        assert.ok(headers["Retry-After"])
        assert.match(jsonPayload.message, /too many/i)
    })

    await t.test("should isolate rate limits across different users", () => {
        const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 1 })
        let nextCount = 0
        const res = {
            set: () => {},
            status: () => res,
            json: () => {}
        }
        const next = () => { nextCount++ }

        // User A request 1 (allowed)
        limiter({ user: { id: "user-A" } }, res, next)
        assert.equal(nextCount, 1)

        // User B request 1 (allowed)
        limiter({ user: { id: "user-B" } }, res, next)
        assert.equal(nextCount, 2)

        // User A request 2 (blocked)
        limiter({ user: { id: "user-A" } }, res, next)
        assert.equal(nextCount, 2)
    })
})
