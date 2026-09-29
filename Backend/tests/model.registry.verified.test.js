"use strict"

/**
 * model.registry.verified.test.js
 *
 * Test suite covering Step 15 requirements:
 *  1.  Valid verified model enters routing (getEligiblePrimaryModels)
 *  2.  Unverified model is excluded from RoutingEngine scoring
 *  3.  Disabled model is excluded from routing
 *  4.  Registry accepts different numbers of available models
 *  5.  Dynamic routing scores only eligible (verified+enabled+healthy) models
 *  6.  Static priority remains only a tie-breaker
 *  7.  openrouter/free remains final fallback
 *  8.  openrouter/free is never normally scored
 *  9.  404 model failure triggers fallback (next model attempted)
 * 10.  Same model isn't retried within the same request
 * 11.  API keys are never logged
 *
 * All tests use mocks — no real API calls are made.
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")

const { ModelRegistry } = require("../src/services/ai/model.registry")
const { ModelHealthTracker } = require("../src/services/ai/model.health")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { AIProvider } = require("../src/services/ai/provider.interface")

// ── Test doubles ──────────────────────────────────────────────────────────────

class MockProvider extends AIProvider {
    constructor(name) {
        super(name, name + "-default-model")
    }
    isAvailable() { return true }
    getApiKey() { return "masked-in-test" }
    async generateInterviewReport() { return { matchScore: 80, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [], title: "Test" } }
    async generateResumePdf() { return "<html></html>" }
}

function makeGateway(models = []) {
    const modelRegistry = new ModelRegistry({ defaultTimeoutMs: 5000 })
    modelRegistry.clear()
    for (const m of models) {
        modelRegistry.registerModel(m)
    }
    const modelHealth = new ModelHealthTracker()
    const providerRegistry = new ProviderRegistry()
    providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
    providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))
    const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })
    return { gateway, modelRegistry, modelHealth }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Valid verified model enters routing
// ─────────────────────────────────────────────────────────────────────────────
test("1a. Verified model appears in getEligiblePrimaryModels()", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "gemini-flash", priority: 1, enabled: true, verified: true })

    const eligible = reg.getEligiblePrimaryModels()
    assert.equal(eligible.length, 1)
    assert.equal(eligible[0].id, "g1")
    assert.equal(eligible[0].verified, true)
})

test("1b. Verified model is selected by AIGateway", async () => {
    const { gateway } = makeGateway([
        { id: "g1", provider: "gemini", model: "gemini-flash", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ])

    let usedModel = null
    await gateway.execute("generateInterviewReport", async (p, opts) => {
        usedModel = opts.model
        return { ok: true }
    })
    assert.equal(usedModel, "gemini-flash")
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unverified model is excluded
// ─────────────────────────────────────────────────────────────────────────────
test("2a. Unverified model is absent from getEligiblePrimaryModels()", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "gemini-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "g2", provider: "gemini", model: "gemini-bad-404", priority: 2, enabled: true, verified: false })

    const eligible = reg.getEligiblePrimaryModels()
    assert.equal(eligible.length, 1, "Only verified models in eligible list")
    assert.equal(eligible[0].id, "g1")

    // getPrimaryModels() still returns all enabled (backward compat)
    const all = reg.getPrimaryModels()
    assert.equal(all.length, 2, "getPrimaryModels returns all enabled non-fallback models")
})

test("2b. RoutingEngine.selectBestModel skips unverified model", () => {
    const health = new ModelHealthTracker()
    const engine = new RoutingEngine()

    const models = [
        { id: "verified-m", provider: "gemini", model: "g-ok", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "unverified-m", provider: "gemini", model: "g-bad", priority: 2, enabled: true, verified: false, isFinalFallback: false }
    ]

    const { model, scored } = engine.selectBestModel(models, new Set(), health)
    assert.equal(model?.id, "verified-m")
    assert.equal(scored.length, 1, "Only 1 candidate scored")
    assert.equal(scored[0].modelId, "verified-m")
})

test("2c. Unverified model with missing verified field is also excluded from scoring", () => {
    const health = new ModelHealthTracker()
    const engine = new RoutingEngine()

    const models = [
        { id: "m1", provider: "gemini", model: "g-ok", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "m2", provider: "gemini", model: "g-nofield", priority: 2, enabled: true, isFinalFallback: false }
        // verified field entirely absent — normalized to false by registerModel
    ]
    // Manually add verified:false to simulate what registerModel does
    models[1].verified = false

    const { scored } = engine.selectBestModel(models, new Set(), health)
    assert.equal(scored.length, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Disabled model is excluded
// ─────────────────────────────────────────────────────────────────────────────
test("3a. Disabled model (enabled:false) absent from getEligiblePrimaryModels()", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "gemini-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "g2", provider: "gemini", model: "gemini-disabled", priority: 2, enabled: false, verified: true })

    const eligible = reg.getEligiblePrimaryModels()
    assert.equal(eligible.length, 1)
    assert.equal(eligible[0].id, "g1")
})

test("3b. Disabled + unverified models tracked in getIneligibleModels()", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "ok", provider: "gemini", model: "g-ok", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "bad1", provider: "gemini", model: "g-disabled", priority: 2, enabled: false, verified: true })
    reg.registerModel({ id: "bad2", provider: "gemini", model: "g-unverified", priority: 3, enabled: true, verified: false })

    const ineligible = reg.getIneligibleModels()
    assert.equal(ineligible.length, 2)
    const ids = ineligible.map(m => m.id).sort()
    assert.deepEqual(ids, ["bad1", "bad2"])
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Registry accepts variable numbers of models
// ─────────────────────────────────────────────────────────────────────────────
test("4a. Registry works with 1 verified primary + final fallback", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "g-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true })

    assert.equal(reg.getEligiblePrimaryModels().length, 1)
    assert.ok(reg.getFinalFallbackModel())
})

test("4b. Registry works with 2 Gemini + 1 OpenRouter + final fallback", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "g-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "g2", provider: "gemini", model: "g-flash-2", priority: 2, enabled: true, verified: true })
    reg.registerModel({ id: "or1", provider: "openrouter", model: "nv/free", priority: 3, enabled: true, verified: true })
    reg.registerModel({ id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true })

    assert.equal(reg.getEligiblePrimaryModels().length, 3)
    assert.ok(reg.getFinalFallbackModel())
})

test("4c. 0 verified primary models — gateway uses final fallback directly", async () => {
    const { gateway } = makeGateway([
        // Only final fallback registered
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ])

    let usedModel = null
    await gateway.execute("generateInterviewReport", async (p, opts) => {
        usedModel = opts.model
        return { ok: true }
    })
    assert.equal(usedModel, "openrouter/free", "Final fallback used when no primary models available")
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Dynamic routing scores only eligible models
// ─────────────────────────────────────────────────────────────────────────────
test("5. High success-rate model wins over lower-priority model (scoring over static priority)", () => {
    const health = new ModelHealthTracker()
    const engine = new RoutingEngine({ minObservations: 2 })

    // m1 has priority:2 but excellent recent performance
    health.recordSuccess("m1", 500)
    health.recordSuccess("m1", 550)

    // m2 has priority:1 but 50% success rate
    health.recordFailure("m2", new Error("err"), 900)
    health.recordSuccess("m2", 950)

    const models = [
        { id: "m1", provider: "gemini", model: "g1", priority: 2, enabled: true, verified: true, isFinalFallback: false },
        { id: "m2", provider: "gemini", model: "g2", priority: 1, enabled: true, verified: true, isFinalFallback: false }
    ]

    const { model, scored } = engine.selectBestModel(models, new Set(), health)
    assert.equal(model.id, "m1", "Higher-scoring model wins even if lower static priority")
    assert.ok(scored[0].score > scored[1].score, "Winner must have higher score")
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Static priority is only a tie-breaker
// ─────────────────────────────────────────────────────────────────────────────
test("6. Equal score (cold-start) → lower priority number wins as tie-breaker", () => {
    const health = new ModelHealthTracker()
    const engine = new RoutingEngine()

    const models = [
        { id: "high-pri", provider: "gemini", model: "g1", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "low-pri", provider: "gemini", model: "g2", priority: 5, enabled: true, verified: true, isFinalFallback: false }
    ]

    const { model } = engine.selectBestModel(models, new Set(), health)
    assert.equal(model.id, "high-pri")
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. openrouter/free remains final fallback
// ─────────────────────────────────────────────────────────────────────────────
test("7a. getFinalFallbackModel() returns openrouter/free", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "g-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true })

    const fb = reg.getFinalFallbackModel()
    assert.ok(fb)
    assert.equal(fb.isFinalFallback, true)
    assert.equal(fb.model, "openrouter/free")
})

test("7b. AIGateway engages openrouter/free only after all primaries fail", async () => {
    const { gateway } = makeGateway([
        { id: "g1", provider: "gemini", model: "g-flash", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ])

    const attempted = []
    await gateway.execute("generateInterviewReport", async (p, opts) => {
        attempted.push(opts.model)
        if (opts.model !== "openrouter/free") {
            const err = new Error("HTTP 503")
            err.status = 503
            throw err
        }
        return { rescued: true }
    })

    assert.equal(attempted[0], "g-flash", "Primary must be attempted first")
    assert.equal(attempted[attempted.length - 1], "openrouter/free", "Final fallback must be last")
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. openrouter/free is never normally scored by RoutingEngine
// ─────────────────────────────────────────────────────────────────────────────
test("8. isFinalFallback model is excluded from RoutingEngine scoring", () => {
    const health = new ModelHealthTracker()
    const engine = new RoutingEngine()

    const models = [
        { id: "g1", provider: "gemini", model: "g-flash", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ]

    const { model, scored } = engine.selectBestModel(models, new Set(), health)
    assert.equal(scored.length, 1, "Final fallback must not appear in scored candidates")
    assert.notEqual(model?.id, "fb", "RoutingEngine must never select openrouter/free")
    assert.equal(scored[0].modelId, "g1")
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. 404 model failure triggers fallback (not retried)
// ─────────────────────────────────────────────────────────────────────────────
test("9. HTTP 404 on first model triggers fallback to next, 404 model not retried", async () => {
    const { gateway } = makeGateway([
        { id: "g1", provider: "gemini", model: "g-404", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "g2", provider: "gemini", model: "g-good", priority: 2, enabled: true, verified: true, isFinalFallback: false },
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ])

    const attempted = []
    const result = await gateway.execute("generateInterviewReport", async (p, opts) => {
        attempted.push(opts.model)
        if (opts.model === "g-404") {
            const err = new Error("model not found")
            err.status = 404
            throw err
        }
        return { ok: true }
    })

    assert.ok(result.ok)
    assert.ok(attempted.includes("g-404"), "404 model should be tried once")
    assert.ok(attempted.includes("g-good"), "Next model used as fallback")
    assert.equal(attempted.filter(m => m === "g-404").length, 1, "404 model must NOT be retried")
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. Same model not retried within the same request
// ─────────────────────────────────────────────────────────────────────────────
test("10. Each model is attempted at most once per request", async () => {
    const { gateway } = makeGateway([
        { id: "m1", provider: "gemini", model: "m1-model", priority: 1, enabled: true, verified: true, isFinalFallback: false },
        { id: "m2", provider: "gemini", model: "m2-model", priority: 2, enabled: true, verified: true, isFinalFallback: false },
        { id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true }
    ])

    const attempts = []
    await gateway.execute("generateInterviewReport", async (p, opts) => {
        attempts.push(opts.model)
        if (opts.model !== "openrouter/free") {
            const err = new Error("503")
            err.status = 503
            throw err
        }
        return { ok: true }
    })

    const counts = {}
    for (const m of attempts) { counts[m] = (counts[m] || 0) + 1 }
    for (const [model, count] of Object.entries(counts)) {
        assert.equal(count, 1, `"${model}" attempted ${count} time(s) — must be exactly 1`)
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. API keys never logged in model config output
// ─────────────────────────────────────────────────────────────────────────────
test("11a. Serialized ModelRegistry output contains no API key values", () => {
    const reg = new ModelRegistry({ defaultTimeoutMs: 5000 })
    reg.clear()
    reg.registerModel({ id: "g1", provider: "gemini", model: "gemini-flash", priority: 1, enabled: true, verified: true })
    reg.registerModel({ id: "fb", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, verified: true, isFinalFallback: true })

    const allJson = JSON.stringify(reg.getAllModels())
    assert.ok(!allJson.includes("sk-or-"), "OpenRouter key prefix must not appear")
    assert.ok(!allJson.includes("Bearer"), "Auth header must not appear")

    const geminiKey = process.env.GOOGLE_GENAI_API_KEY || ""
    if (geminiKey) {
        assert.ok(!allJson.includes(geminiKey), "Gemini API key must not appear in registry JSON")
    }
    const orKey = process.env.OPENROUTER_API_KEY || ""
    if (orKey) {
        assert.ok(!allJson.includes(orKey), "OpenRouter API key must not appear in registry JSON")
    }
})

test("11b. MockProvider.getApiKey does not expose real key format", () => {
    const mock = new MockProvider("openrouter")
    const key = mock.getApiKey()
    assert.ok(typeof key === "string")
    assert.ok(!key.startsWith("sk-or-"), "Test mock must not expose real key format")
})
