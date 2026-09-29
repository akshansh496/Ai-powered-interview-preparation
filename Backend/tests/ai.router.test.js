"use strict"

/**
 * ai.router.test.js
 *
 * Tests for AIRouter provider registration, model-aware routing, fallback, and env-flag behavior.
 * Uses isolated ModelRegistry + ProviderRegistry injections — no global singletons.
 */

const test = require("node:test")
const assert = require("node:assert/strict")
const { AIRouter } = require("../src/services/ai/ai.router")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { ModelRegistry } = require("../src/services/ai/model.registry")
const { ModelHealthTracker } = require("../src/services/ai/model.health")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, model, handler) {
        super(name, model)
        this.handler = handler || (async () => ({ ok: true }))
        this.calls = 0
    }
    isAvailable() { return true }
    async generateInterviewReport(data, options) {
        this.calls++
        return await this.handler("generateInterviewReport", data, options)
    }
    async generateResumePdf(data, options) {
        this.calls++
        return await this.handler("generateResumePdf", data, options)
    }
}

/**
 * Build a fully isolated gateway+router pair with injected models and providers.
 */
function makeRouter(models = [], providerSetup = {}) {
    const registry = new ProviderRegistry()
    const modelRegistry = new ModelRegistry({ defaultTimeoutMs: 5000 })
    const modelHealth = new ModelHealthTracker()
    const routingEngine = new RoutingEngine()

    modelRegistry.clear()
    for (const m of models) {
        modelRegistry.registerModel(m)
    }
    for (const [name, provider] of Object.entries(providerSetup)) {
        registry.registerProvider(name, provider)
    }

    const gateway = new AIGateway({ registry, modelRegistry, modelHealth, routingEngine })
    const router = new AIRouter(gateway)
    return { router, gateway, registry, modelRegistry, modelHealth, routingEngine }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Registration & Registry tests
// ─────────────────────────────────────────────────────────────────────────────
test("AIRouter - Provider Registration & Registry tests", async (t) => {

    await t.test("should initialize with default gemini and openrouter providers", () => {
        const router = new AIRouter()
        assert.equal(router.hasProvider("gemini"), true)
        assert.equal(router.hasProvider("openrouter"), true)
        assert.equal(router.getProvider("gemini").name, "gemini")
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

// ─────────────────────────────────────────────────────────────────────────────
// Routing & Execution tests
// ─────────────────────────────────────────────────────────────────────────────
test("AIRouter - Routing & Execution tests", async (t) => {

    await t.test("should execute task on the highest priority evaluated model", async () => {
        const mockGemini = new MockProvider("gemini", "gemini-model", async () => ({ report: "from-gemini" }))

        const { router } = makeRouter(
            [
                { id: "g1", provider: "gemini", model: "gemini-model", priority: 1, enabled: true, verified: true, isFinalFallback: false }
            ],
            { gemini: mockGemini }
        )

        const result = await router.route("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.deepEqual(result, { report: "from-gemini" })
        assert.equal(mockGemini.calls, 1)
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fallback Mechanism tests
// ─────────────────────────────────────────────────────────────────────────────
test("AIRouter - Fallback Mechanism tests", async (t) => {

    await t.test("should fallback to secondary provider when primary encounters transient error (503)", async () => {
        const transientError = new Error("Service temporarily overloaded")
        transientError.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw transientError })
        const mockOpenrouter = new MockProvider("openrouter", "openrouter-model", async () => ({ report: "rescued-by-openrouter" }))

        const { router } = makeRouter(
            [
                { id: "g1", provider: "gemini", model: "gemini-model", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-model", priority: 2, enabled: true, verified: true, isFinalFallback: false },
                { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
            ],
            { gemini: mockGemini, openrouter: mockOpenrouter }
        )

        const result = await router.route("generateInterviewReport", (p, opts) => p.generateInterviewReport({}, opts))
        assert.deepEqual(result, { report: "rescued-by-openrouter" })
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockOpenrouter.calls, 1)
    })

    await t.test("should NOT fallback on non-transient / validation errors", async () => {
        const validationError = new Error("Validation failed: input violates schema")
        validationError.code = "VALIDATION_ERROR"

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw validationError })
        const mockOpenrouter = new MockProvider("openrouter", "openrouter-model", async () => ({ report: "should-not-be-called" }))

        const { router } = makeRouter(
            [
                { id: "g1", provider: "gemini", model: "gemini-model", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-model", priority: 2, enabled: true, verified: true, isFinalFallback: false }
            ],
            { gemini: mockGemini, openrouter: mockOpenrouter }
        )

        await assert.rejects(
            async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "VALIDATION_ERROR"
        )
        assert.equal(mockGemini.calls, 1)
        assert.equal(mockOpenrouter.calls, 0)
    })

    await t.test("should throw controlled error when all providers fail", async () => {
        const err1 = new Error("Gemini quota 429"); err1.status = 429
        const err2 = new Error("OpenRouter 503 unavailable"); err2.status = 503

        const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw err1 })
        const mockOpenrouter = new MockProvider("openrouter", "openrouter-model", async () => { throw err2 })
        const mockFallback = new MockProvider("openrouter", "openrouter/free", async () => { throw Object.assign(new Error("free also failed"), { status: 503 }) })

        // Use execute callback form so we can differentiate by model
        const { gateway, modelRegistry, registry } = makeRouter(
            [
                { id: "g1", provider: "gemini", model: "gemini-model", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-model", priority: 2, enabled: true, verified: true, isFinalFallback: false },
                { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
            ],
            { gemini: mockGemini, openrouter: mockOpenrouter }
        )

        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", async (p, opts) => {
                if (opts.model === "gemini-model") { throw err1 }
                if (opts.model === "openrouter-model") { throw err2 }
                throw Object.assign(new Error("free also failed"), { status: 503 })
            }),
            (err) => err.code === "PROVIDER_UNAVAILABLE" || err.statusCode === 503
        )
    })

    await t.test("should respect AI_ENABLE_FALLBACK=false", async () => {
        const originalEnv = process.env.AI_ENABLE_FALLBACK
        process.env.AI_ENABLE_FALLBACK = "false"

        try {
            const transientError = new Error("Overloaded")
            transientError.status = 503

            const mockGemini = new MockProvider("gemini", "gemini-model", async () => { throw transientError })
            const mockOpenrouter = new MockProvider("openrouter", "openrouter-model", async () => ({ report: "fallback" }))

            const { router } = makeRouter(
                [
                    { id: "g1", provider: "gemini", model: "gemini-model", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                    { id: "or1", provider: "openrouter", model: "openrouter-model", priority: 2, enabled: true, verified: true, isFinalFallback: false }
                ],
                { gemini: mockGemini, openrouter: mockOpenrouter }
            )

            await assert.rejects(
                async () => await router.route("generateInterviewReport", (p) => p.generateInterviewReport({})),
                (err) => err.status === 503 || err.statusCode === 503 || err.code === "PROVIDER_UNAVAILABLE"
            )
            assert.equal(mockGemini.calls, 1)
            assert.equal(mockOpenrouter.calls, 0)
        } finally {
            if (originalEnv !== undefined) {
                process.env.AI_ENABLE_FALLBACK = originalEnv
            } else {
                delete process.env.AI_ENABLE_FALLBACK
            }
        }
    })
})
