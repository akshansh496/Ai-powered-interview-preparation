const test = require("node:test")
const assert = require("node:assert/strict")
const { AIRouter } = require("../src/services/ai/ai.router")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, model, handler) {
        super(name, model)
        this.handler = handler
        this.calls = 0
    }

    isAvailable() {
        return true
    }

    async generateInterviewReport(data, options) {
        this.calls++
        return await this.handler("generateInterviewReport", data, options)
    }

    async generateResumePdf(data, options) {
        this.calls++
        return await this.handler("generateResumePdf", data, options)
    }
}

test("AIRouter - Provider Registration & Registry tests", async (t) => {

    await t.test("should initialize with default gemini and grok providers", () => {
        const router = new AIRouter()
        assert.equal(router.hasProvider("gemini"), true)
        assert.equal(router.hasProvider("grok"), true)
        assert.equal(router.getProvider("gemini").name, "gemini")
        assert.equal(router.getProvider("grok").name, "grok")
    })

    await t.test("should throw CONFIGURATION_ERROR for unknown providers", () => {
        const router = new AIRouter()
        assert.throws(
            () => router.getProvider("non-existent-provider"),
            (err) => err.code === "CONFIGURATION_ERROR"
        )
    })

    await t.test("should register a valid custom provider", () => {
        const router = new AIRouter()
        const custom = new MockProvider("custom-ai", "custom-model-1", async () => ({ success: true }))
        router.registerProvider("custom-ai", custom)
        assert.equal(router.hasProvider("custom-ai"), true)
        assert.equal(router.getProvider("custom-ai").name, "custom-ai")
    })
})

test("AIRouter - Routing & Execution tests", async (t) => {

    await t.test("should execute task on the default provider", async () => {
        const router = new AIRouter()
        const mockGemini = new MockProvider("gemini", "gemini-model", async () => ({ report: "from-gemini" }))
        router.registerProvider("gemini", mockGemini)

        const result = await router.route("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.deepEqual(result, { report: "from-gemini" })
        assert.equal(mockGemini.calls, 1)
    })

    await t.test("should honor request-level provider override", async () => {
        const router = new AIRouter()
        const mockGemini = new MockProvider("gemini", "gemini-model", async () => ({ report: "from-gemini" }))
        const mockGrok = new MockProvider("grok", "grok-model", async () => ({ report: "from-grok" }))
        router.registerProvider("gemini", mockGemini)
        router.registerProvider("grok", mockGrok)

        const result = await router.route(
            "generateInterviewReport",
            (p) => p.generateInterviewReport({}),
            { provider: "grok" }
        )
        assert.deepEqual(result, { report: "from-grok" })
        assert.equal(mockGrok.calls, 1)
        assert.equal(mockGemini.calls, 0)
    })
})

test("AIRouter - Fallback Mechanism tests", async (t) => {

    await t.test("should fallback to secondary provider when primary encounters transient error (503)", async () => {
        const router = new AIRouter()
        const transientError = new Error("Service temporarily overloaded")
        transientError.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => {
            throw transientError
        })
        const mockGrok = new MockProvider("grok", "grok-model", async () => {
            return { report: "rescued-by-grok" }
        })

        router.registerProvider("gemini", mockGemini)
        router.registerProvider("grok", mockGrok)

        const result = await router.route("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.deepEqual(result, { report: "rescued-by-grok" })
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 1)
    })

    await t.test("should NOT fallback on non-transient / validation errors", async () => {
        const router = new AIRouter()
        const validationError = new Error("Validation failed: input violates schema")
        validationError.code = "VALIDATION_ERROR"

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => {
            throw validationError
        })
        const mockGrok = new MockProvider("grok", "grok-model", async () => {
            return { report: "should-not-be-called" }
        })

        router.registerProvider("gemini", mockGemini)
        router.registerProvider("grok", mockGrok)

        await assert.rejects(
            async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "VALIDATION_ERROR"
        )
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 0)
    })

    await t.test("should throw controlled error when both primary and fallback fail", async () => {
        const router = new AIRouter()
        const err1 = new Error("Gemini quota 429")
        err1.status = 429
        const err2 = new Error("Grok 503 unavailable")
        err2.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw err1 })
        const mockGrok = new MockProvider("grok", "grok-model", async () => { throw err2 })

        router.registerProvider("gemini", mockGemini)
        router.registerProvider("grok", mockGrok)

        await assert.rejects(
            async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.status === 503
        )
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 1)
    })

    await t.test("should respect AI_ENABLE_FALLBACK=false", async () => {
        const originalEnv = process.env.AI_ENABLE_FALLBACK
        process.env.AI_ENABLE_FALLBACK = "false"

        try {
            const router = new AIRouter()
            const transientError = new Error("Overloaded")
            transientError.status = 503

            const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw transientError })
            const mockGrok = new MockProvider("grok", "grok-model", async () => ({ report: "fallback" }))

            router.registerProvider("gemini", mockGemini)
            router.registerProvider("grok", mockGrok)

            await assert.rejects(
                async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
                (err) => err.status === 503
            )
            assert.equal(mockGemini.calls, 1)
            assert.equal(mockGrok.calls, 0)
        } finally {
            if (originalEnv !== undefined) {
                process.env.AI_ENABLE_FALLBACK = originalEnv
            } else {
                delete process.env.AI_ENABLE_FALLBACK
            }
        }
    })
})
