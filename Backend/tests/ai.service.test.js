const test = require("node:test")
const assert = require("node:assert/strict")
const { normalizeAIError, AIError } = require("../src/services/ai.service")

test("AI Service - normalizeAIError tests", async (t) => {

    await t.test("should pass through existing AIError instance without modification", () => {
        const original = new AIError("Custom error", { code: "CUSTOM_CODE", statusCode: 400 })
        const normalized = normalizeAIError(original)
        assert.equal(normalized, original)
        assert.equal(normalized.code, "CUSTOM_CODE")
        assert.equal(normalized.statusCode, 400)
    })

    await t.test("should map rate limit errors to 429 and RATE_LIMIT_EXCEEDED", () => {
        const error = new Error("Resource exhausted: quota exceeded")
        error.status = 429
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 429)
        assert.equal(normalized.code, "RATE_LIMIT_EXCEEDED")
        assert.equal(normalized.isTransient, true)
        assert.match(normalized.message, /rate limit reached/i)
    })

    await t.test("should map timeout errors to 504 and REQUEST_TIMEOUT", () => {
        const error = new Error("AI request timed out after 60000ms")
        error.code = "REQUEST_TIMEOUT"
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 504)
        assert.equal(normalized.code, "REQUEST_TIMEOUT")
        assert.equal(normalized.isTransient, true)
        assert.match(normalized.message, /timed out/i)
    })

    await t.test("should map 503 / overloaded errors to 503 and PROVIDER_UNAVAILABLE", () => {
        const error = new Error("The model is overloaded. Please try again later.")
        error.status = 503
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 503)
        assert.equal(normalized.code, "PROVIDER_UNAVAILABLE")
        assert.equal(normalized.isTransient, true)
        assert.match(normalized.message, /temporarily unavailable/i)
    })

    await t.test("should map validation / schema errors to 422 and VALIDATION_ERROR", () => {
        const error = new Error("Zod validation failed: missing field")
        error.code = "VALIDATION_ERROR"
        error.details = [{ path: ["title"], message: "Required" }]
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 422)
        assert.equal(normalized.code, "VALIDATION_ERROR")
        assert.equal(normalized.isTransient, false)
        assert.ok(normalized.details)
    })

    await t.test("should sanitize and never leak API keys in configuration errors", () => {
        const error = new Error("Invalid API key provided: AIzaSySecretKey12345")
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 500)
        assert.equal(normalized.code, "CONFIGURATION_ERROR")
        assert.ok(!normalized.message.includes("AIzaSySecretKey12345"))
        assert.match(normalized.message, /configuration error/i)
    })

    await t.test("should fallback to generic 500 on unexpected errors", () => {
        const error = new Error("Unexpected internal crash")
        const normalized = normalizeAIError(error)
        assert.equal(normalized.statusCode, 500)
        assert.equal(normalized.code, "AI_GENERIC_ERROR")
        assert.match(normalized.message, /failed to generate ai response/i)
    })
})
