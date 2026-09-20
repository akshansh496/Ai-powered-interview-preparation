const test = require("node:test")
const assert = require("node:assert/strict")
const { AIRouter } = require("../src/services/ai/ai.router")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
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

    await t.test("should initialize with default gemini, grok, and openrouter providers", () => {
        const router = new AIRouter()
        assert.equal(router.hasProvider("gemini"), true)
        assert.equal(router.hasProvider("grok"), true)
        assert.equal(router.hasProvider("openrouter"), true)
        assert.equal(router.getProvider("gemini").name, "gemini")
        assert.equal(router.getProvider("grok").name, "grok")
        assert.equal(router.getProvider("openrouter").name, "openrouter")
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

    await t.test("should execute task on the highest scoring evaluated provider", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })
        const router = new AIRouter(gateway)

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => ({ report: "from-gemini" }))
        registry.registerProvider("gemini", mockGemini)

        const result = await router.route("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.deepEqual(result, { report: "from-gemini" })
        assert.equal(mockGemini.calls, 1)
    })
})

test("AIRouter - Fallback Mechanism tests", async (t) => {

    await t.test("should fallback to secondary provider when primary encounters transient error (503)", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })
        const router = new AIRouter(gateway)

        const transientError = new Error("Service temporarily overloaded")
        transientError.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => {
            throw transientError
        })
        const mockGrok = new MockProvider("grok", "grok-model", async () => {
            return { report: "rescued-by-grok" }
        })

        // Initial health: gemini preferred
        for (let i = 0; i < 5; i++) engine.recordSuccess("gemini", 300)

        registry.registerProvider("gemini", mockGemini)
        registry.registerProvider("grok", mockGrok)

        const result = await router.route("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.deepEqual(result, { report: "rescued-by-grok" })
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 1)
    })

    await t.test("should NOT fallback on non-transient / validation errors", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })
        const router = new AIRouter(gateway)

        const validationError = new Error("Validation failed: input violates schema")
        validationError.code = "VALIDATION_ERROR"

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => {
            throw validationError
        })
        const mockGrok = new MockProvider("grok", "grok-model", async () => {
            return { report: "should-not-be-called" }
        })

        registry.registerProvider("gemini", mockGemini)
        registry.registerProvider("grok", mockGrok)

        await assert.rejects(
            async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "VALIDATION_ERROR"
        )
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 0)
    })

    await t.test("should throw controlled error when all providers fail", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })
        const router = new AIRouter(gateway)

        const err1 = new Error("Gemini quota 429")
        err1.status = 429
        const err2 = new Error("Grok 503 unavailable")
        err2.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw err1 })
        const mockGrok = new MockProvider("grok", "grok-model", async () => { throw err2 })

        registry.registerProvider("gemini", mockGemini)
        registry.registerProvider("grok", mockGrok)

        await assert.rejects(
            async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "PROVIDER_UNAVAILABLE" || err.status === 503
        )
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockGrok.calls, 1)
    })

    await t.test("should respect AI_ENABLE_FALLBACK=false", async () => {
        const originalEnv = process.env.AI_ENABLE_FALLBACK
        process.env.AI_ENABLE_FALLBACK = "false"

        try {
            const registry = new ProviderRegistry()
            const engine = new RoutingEngine()
            const gateway = new AIGateway({ registry, routingEngine: engine })
            const router = new AIRouter(gateway)

            const transientError = new Error("Overloaded")
            transientError.status = 503

            const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw transientError })
            const mockGrok = new MockProvider("grok", "grok-model", async () => ({ report: "fallback" }))

            registry.registerProvider("gemini", mockGemini)
            registry.registerProvider("grok", mockGrok)

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


