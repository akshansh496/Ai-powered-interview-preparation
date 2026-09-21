const test = require("node:test")
const assert = require("node:assert/strict")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, isAvailable = true) {
        super(name, "mock-model")
        this._available = isAvailable
    }
    isAvailable() {
        return this._available
    }
    async generateInterviewReport() {
        return {}
    }
    async generateResumePdf() {
        return "<html></html>"
    }
}

test("RoutingEngine - Suitability Scoring & Health Tracking tests", async (t) => {

    await t.test("should score healthy, available provider with high score", () => {
        const engine = new RoutingEngine()
        const provider = new MockProvider("gemini", true)

        const evaluation = engine.calculateScore(provider)
        assert.equal(evaluation.eligible, true)
        assert.ok(evaluation.score >= 80, `Expected score >= 80, got ${evaluation.score}`)
        assert.ok(evaluation.reason.includes("healthy"))
    })

    await t.test("should disqualify and give -1 to unavailable provider", () => {
        const engine = new RoutingEngine()
        const provider = new MockProvider("grok", false)

        const evaluation = engine.calculateScore(provider)
        assert.equal(evaluation.eligible, false)
        assert.equal(evaluation.score, -1)
        assert.ok(evaluation.reason.includes("unavailable"))
    })

    await t.test("should disqualify provider currently in rate-limit cooldown (429)", () => {
        const engine = new RoutingEngine({ rateLimitCooldownMs: 5000 })
        const provider = new MockProvider("openrouter", true)

        // Record a 429 error
        const rateLimitErr = new Error("Rate limit exceeded")
        rateLimitErr.status = 429
        engine.recordFailure(provider.name, rateLimitErr, 120)

        assert.equal(engine.isRateLimited(provider.name), true)

        const evaluation = engine.calculateScore(provider)
        assert.equal(evaluation.eligible, false)
        assert.equal(evaluation.score, -1)
        assert.ok(evaluation.reason.includes("rate limited"))
    })

    await t.test("should restore provider eligibility after rate-limit cooldown expires", async () => {
        const engine = new RoutingEngine({ rateLimitCooldownMs: 50 })
        const provider = new MockProvider("openrouter", true)

        const rateLimitErr = new Error("Rate limit exceeded")
        rateLimitErr.status = 429
        engine.recordFailure(provider.name, rateLimitErr, 120)
        assert.equal(engine.isRateLimited(provider.name), true)

        // Wait for cooldown to expire
        await new Promise(resolve => setTimeout(resolve, 60))

        assert.equal(engine.isRateLimited(provider.name), false)
        const evaluation = engine.calculateScore(provider)
        assert.equal(evaluation.eligible, true)
    })

    await t.test("should prefer high reliability over fast latency with poor reliability (Requirement 7)", () => {
        const engine = new RoutingEngine()
        const providerA = new MockProvider("providerA", true) // Fast (500ms) but 70% success
        const providerB = new MockProvider("providerB", true) // Slower (800ms) but 98% success

        // Simulate Provider A: 7 successes (500ms), 3 failures
        for (let i = 0; i < 7; i++) engine.recordSuccess(providerA.name, 500)
        for (let i = 0; i < 3; i++) engine.recordFailure(providerA.name, new Error("Server error"), 500)

        // Simulate Provider B: 49 successes (800ms), 1 failure
        for (let i = 0; i < 49; i++) engine.recordSuccess(providerB.name, 800)
        engine.recordFailure(providerB.name, new Error("Transient error"), 800)
        // Recover Provider B
        engine.recordSuccess(providerB.name, 800)

        const scoreA = engine.calculateScore(providerA).score
        const scoreB = engine.calculateScore(providerB).score

        assert.ok(scoreB > scoreA, `Expected reliable Provider B (${scoreB}) to outscore unreliable Provider A (${scoreA})`)
    })
})

test("RoutingEngine - Candidate Evaluation & Filtering tests", async (t) => {

    await t.test("should evaluate and rank multiple available providers", () => {
        const engine = new RoutingEngine()
        const gemini = new MockProvider("gemini", true)
        const grok = new MockProvider("grok", true)
        const openrouter = new MockProvider("openrouter", true)

        // Give gemini more successful low-latency samples
        for (let i = 0; i < 10; i++) engine.recordSuccess(gemini.name, 400)
        for (let i = 0; i < 10; i++) engine.recordSuccess(grok.name, 900)
        for (let i = 0; i < 10; i++) engine.recordSuccess(openrouter.name, 1200)

        const evalResult = engine.evaluate([gemini, grok, openrouter])
        assert.equal(evalResult.candidates.length, 3)
        assert.equal(evalResult.selected.provider.name, "gemini")
    })

    await t.test("should filter out excluded providers for loop protection", () => {
        const engine = new RoutingEngine()
        const gemini = new MockProvider("gemini", true)
        const grok = new MockProvider("grok", true)
        const openrouter = new MockProvider("openrouter", true)

        const evalResult = engine.evaluate([gemini, grok, openrouter], {
            excludedProviders: ["gemini"]
        })

        assert.equal(evalResult.candidates.length, 2)
        assert.equal(evalResult.candidates.some(c => c.provider.name === "gemini"), false)
        assert.ok(evalResult.selected.provider.name === "grok" || evalResult.selected.provider.name === "openrouter")
    })

    await t.test("should return null selected when all providers are excluded or unavailable", () => {
        const engine = new RoutingEngine()
        const gemini = new MockProvider("gemini", false)
        const grok = new MockProvider("grok", false)

        const evalResult = engine.evaluate([gemini, grok])
        assert.equal(evalResult.selected, null)
        assert.equal(evalResult.candidates.length, 0)
    })
})
