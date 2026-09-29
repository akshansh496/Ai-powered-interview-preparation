"use strict"

/**
 * ai.gateway.test.js
 *
 * Tests for AIGateway model-aware routing, dynamic selection, fallback, and observability.
 * Uses isolated ModelRegistry + ProviderRegistry injections — no global singletons.
 */

const test = require("node:test")
const assert = require("node:assert/strict")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { ModelRegistry } = require("../src/services/ai/model.registry")
const { ModelHealthTracker } = require("../src/services/ai/model.health")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, model = "mock-v1", isAvailable = true) {
        super(name, model)
        this._available = isAvailable
        this.callCount = 0
    }

    isAvailable() { return this._available }
    setAvailable(flag) { this._available = flag }

    async generateInterviewReport() {
        this.callCount++
        return {
            title: "Software Engineer",
            matchScore: 90,
            technicalQuestions: [],
            behavioralQuestions: [],
            skillGaps: [],
            preparationPlan: []
        }
    }

    async generateResumePdf() {
        this.callCount++
        return "<h1>Resume</h1>"
    }
}

/**
 * Helper: creates an isolated gateway with its own registry, model registry, health tracker, routing engine.
 */
function makeGateway(models = [], providerSetup = {}) {
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
    return { gateway, registry, modelRegistry, modelHealth, routingEngine }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Model Selection & Execution
// ─────────────────────────────────────────────────────────────────────────────
test("AIGateway - Dynamic Model Selection & Execution tests", async (t) => {

    await t.test("should dynamically select and execute with the highest priority available model", async () => {
        const gemini = new MockProvider("gemini", "gemini-fast", true)
        const openrouter = new MockProvider("openrouter", "openrouter-b", true)

        const { gateway, modelHealth } = makeGateway(
            [
                { id: "gemini-fast", provider: "gemini", model: "gemini-fast", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "openrouter-b", provider: "openrouter", model: "openrouter-b", priority: 2, enabled: true, verified: true, isFinalFallback: false },
                { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
            ],
            { gemini, openrouter }
        )

        // Give gemini more observations → higher success score
        for (let i = 0; i < 5; i++) modelHealth.recordSuccess("gemini-fast", 400)
        for (let i = 0; i < 5; i++) modelHealth.recordSuccess("openrouter-b", 900)

        const result = await gateway.execute("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.equal(result.title, "Software Engineer")
        assert.equal(gemini.callCount, 1, "Faster/higher-scoring provider should be selected")
        assert.equal(openrouter.callCount, 0)
    })

    await t.test("should throw PROVIDER_UNAVAILABLE when all registered providers/models are unavailable", async () => {
        const gemini = new MockProvider("gemini", "gemini-fast", false)

        const { gateway } = makeGateway(
            [
                { id: "g1", provider: "gemini", model: "gemini-fast", priority: 1, enabled: true, verified: true, isFinalFallback: false }
            ],
            { gemini }
        )

        await assert.rejects(
            () => gateway.execute("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "PROVIDER_UNAVAILABLE"
        )
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Fallback and Resilience
// ─────────────────────────────────────────────────────────────────────────────
test("AIGateway - Dynamic Fallback and Resilience tests", async (t) => {

    await t.test("should dynamically fallback to secondary provider when primary returns transient 503", async () => {
        const gemini = new MockProvider("gemini", "gemini-primary", true)
        const openrouter = new MockProvider("openrouter", "openrouter-secondary", true)

        const { gateway } = makeGateway(
            [
                { id: "g1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-secondary", priority: 2, enabled: true, verified: true, isFinalFallback: false },
                { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
            ],
            { gemini, openrouter }
        )

        let geminiAttempts = 0
        let openrouterAttempts = 0

        const result = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            if (opts.model === "gemini-primary") {
                geminiAttempts++
                const err = new Error("Gemini 503 Service Unavailable")
                err.status = 503
                throw err
            }
            openrouterAttempts++
            return { title: "Backend Engineer", matchScore: 95, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [] }
        })

        assert.equal(result.title, "Backend Engineer")
        assert.equal(geminiAttempts, 1)
        assert.equal(openrouterAttempts, 1)
    })

    await t.test("should NOT fallback on non-transient validation errors (VALIDATION_ERROR)", async () => {
        const gemini = new MockProvider("gemini", "gemini-primary", true)
        const openrouter = new MockProvider("openrouter", "openrouter-secondary", true)

        const { gateway } = makeGateway(
            [
                { id: "g1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-secondary", priority: 2, enabled: true, verified: true, isFinalFallback: false }
            ],
            { gemini, openrouter }
        )

        let openrouterCalled = false

        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", async (provider, opts) => {
                if (opts.model === "gemini-primary") {
                    const valErr = new Error("Schema validation failed")
                    valErr.code = "VALIDATION_ERROR"
                    throw valErr
                }
                openrouterCalled = true
                return {}
            }),
            (err) => err.code === "VALIDATION_ERROR"
        )

        assert.equal(openrouterCalled, false, "Fallback must not occur on non-transient validation errors")
    })

    await t.test("should dynamically exclude model in cooldown from subsequent requests", async () => {
        const gemini = new MockProvider("gemini", "gemini-primary", true)
        const openrouter = new MockProvider("openrouter", "openrouter-secondary", true)

        const { gateway, modelHealth } = makeGateway(
            [
                { id: "g1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true, verified: true, isFinalFallback: false },
                { id: "or1", provider: "openrouter", model: "openrouter-secondary", priority: 2, enabled: true, verified: true, isFinalFallback: false },
                { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
            ],
            { gemini, openrouter }
        )

        // Trigger enough failures to put gemini-primary in cooldown
        const threshold = parseInt(process.env.AI_MODEL_FAILURE_THRESHOLD) || 3
        for (let i = 0; i < threshold; i++) {
            modelHealth.recordFailure("g1", new Error("Service Error"), 500)
        }

        // Now g1 is in cooldown — openrouter should be selected immediately
        let selectedModel = null
        await gateway.execute("generateInterviewReport", async (provider, opts) => {
            selectedModel = opts.model
            return { title: "Handled", matchScore: 80, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [] }
        })

        assert.notEqual(selectedModel, "gemini-primary", "Cooldown model must be skipped")
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// Observability & Logging Banners
// ─────────────────────────────────────────────────────────────────────────────
test("AIGateway - Observability & Logging Banners tests", async (t) => {

    await t.test("should print AI GATEWAY and AI RESPONSE GENERATED banners", async () => {
        const gemini = new MockProvider("gemini", "gemini-primary", true)

        const { gateway } = makeGateway(
            [
                { id: "g1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true, verified: true, isFinalFallback: false }
            ],
            { gemini }
        )

        const logs = []
        const originalLog = console.log
        console.log = (...args) => logs.push(args.join(" "))

        try {
            await gateway.execute("generateInterviewReport", async (p) => p.generateInterviewReport({}))
            const logOutput = logs.join("\n")
            assert.ok(logOutput.includes("AI GATEWAY"), "Expected AI GATEWAY banner")
            assert.ok(logOutput.includes("AI RESPONSE GENERATED"), "Expected AI RESPONSE GENERATED banner")
            assert.ok(logOutput.includes("Provider: GEMINI"), "Expected provider name in banner")
        } finally {
            console.log = originalLog
        }
    })
})
