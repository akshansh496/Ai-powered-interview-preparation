/**
 * routing.engine.test.js — Unit tests for RoutingEngine dynamic model scoring & selection.
 *
 * All tests are isolated: each uses fresh RoutingEngine and ModelHealthTracker instances.
 * No external dependencies, no network calls, no side effects.
 */

const test = require("node:test")
const assert = require("node:assert/strict")
const {
    RoutingEngine,
    WEIGHT_SUCCESS,
    WEIGHT_LATENCY,
    WEIGHT_HEALTH,
    WEIGHT_AVAILABILITY,
    LATENCY_BEST_MS,
    LATENCY_WORST_MS,
    COLD_START_SUCCESS_RATE,
    COLD_START_LATENCY_SCORE,
    MIN_OBSERVATIONS
} = require("../src/services/ai/routing.engine")
const { ModelHealthTracker } = require("../src/services/ai/model.health")

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeModel(id, priority = 1, overrides = {}) {
    return {
        id,
        provider: "gemini",
        model: `model-${id}`,
        priority,
        enabled: true,
        isFinalFallback: false,
        timeoutMs: 8000,
        ...overrides
    }
}

/**
 * Seeds a health tracker with N successful observations for a model.
 * Uses minObs + 1 by default so cold-start guard is bypassed.
 */
function seedSuccesses(tracker, modelId, count, latencyMs = 500) {
    for (let i = 0; i < count; i++) {
        tracker.recordSuccess(modelId, latencyMs)
    }
}

function seedFailures(tracker, modelId, count) {
    for (let i = 0; i < count; i++) {
        tracker.recordFailure(modelId, new Error("TRANSIENT"), 0)
    }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test("RoutingEngine — Unit Test Suite", async (t) => {

    // ── 1. Constants & weights ─────────────────────────────────────────────────
    await t.test("1. Exported constants match expected values", () => {
        assert.equal(WEIGHT_SUCCESS, 0.45)
        assert.equal(WEIGHT_LATENCY, 0.30)
        assert.equal(WEIGHT_HEALTH, 0.20)
        assert.equal(WEIGHT_AVAILABILITY, 0.05)
        assert.equal(LATENCY_BEST_MS, 1000)
        assert.equal(LATENCY_WORST_MS, 7000)
        assert.equal(COLD_START_SUCCESS_RATE, 0.90)
        assert.equal(COLD_START_LATENCY_SCORE, 0.70)
        assert.equal(MIN_OBSERVATIONS, 3)
    })

    // ── 2. normalizeLatency ────────────────────────────────────────────────────
    await t.test("2a. normalizeLatency: latency at LATENCY_BEST_MS → 1.0", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(1000), 1.0)
    })

    await t.test("2b. normalizeLatency: latency below LATENCY_BEST_MS → 1.0", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(500), 1.0)
        assert.equal(engine.normalizeLatency(0), 1.0)
    })

    await t.test("2c. normalizeLatency: latency at LATENCY_WORST_MS → 0.0", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(7000), 0.0)
    })

    await t.test("2d. normalizeLatency: latency above LATENCY_WORST_MS → 0.0", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(9000), 0.0)
        assert.equal(engine.normalizeLatency(100000), 0.0)
    })

    await t.test("2e. normalizeLatency: midpoint (4000ms) → ~0.5", () => {
        const engine = new RoutingEngine()
        const score = engine.normalizeLatency(4000)
        assert.ok(Math.abs(score - 0.5) < 1e-9, `Expected ~0.5, got ${score}`)
    })

    await t.test("2f. normalizeLatency: null → coldStartLatencyScore", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(null), COLD_START_LATENCY_SCORE)
    })

    await t.test("2g. normalizeLatency: NaN → coldStartLatencyScore", () => {
        const engine = new RoutingEngine()
        assert.equal(engine.normalizeLatency(NaN), COLD_START_LATENCY_SCORE)
    })

    await t.test("2h. normalizeLatency: custom thresholds respected", () => {
        const engine = new RoutingEngine({ latencyBestMs: 200, latencyWorstMs: 2000 })
        assert.equal(engine.normalizeLatency(200), 1.0)
        assert.equal(engine.normalizeLatency(2000), 0.0)
        // midpoint = 1100ms
        const mid = engine.normalizeLatency(1100)
        assert.ok(Math.abs(mid - 0.5) < 1e-9, `Expected ~0.5, got ${mid}`)
    })

    // ── 3. scoreModel — cold-start behaviour ───────────────────────────────────
    await t.test("3a. scoreModel: cold-start model uses defaults (no observations)", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const model = makeModel("cold-model", 1)

        const { score, components } = engine.scoreModel(model, tracker)

        assert.equal(components.coldStart, true)
        assert.equal(components.successScore, COLD_START_SUCCESS_RATE)
        assert.equal(components.latencyScore, COLD_START_LATENCY_SCORE)
        assert.equal(components.healthScore, 1.0)
        assert.equal(components.availabilityScore, 1.0)

        // Expected: 0.45*0.90 + 0.30*0.70 + 0.20*1.0 + 0.05*1.0 = 0.405+0.21+0.20+0.05 = 0.865
        const expected = 0.45 * 0.90 + 0.30 * 0.70 + 0.20 * 1.0 + 0.05 * 1.0
        assert.ok(Math.abs(score - expected) < 1e-9, `Expected ${expected}, got ${score}`)
    })

    await t.test("3b. scoreModel: insufficient observations (< MIN_OBSERVATIONS) still uses cold-start", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const model = makeModel("model-x", 1)

        // Seed only MIN_OBSERVATIONS - 1 successes
        seedSuccesses(tracker, "model-x", MIN_OBSERVATIONS - 1, 800)

        const { components } = engine.scoreModel(model, tracker)
        assert.equal(components.coldStart, true)
    })

    await t.test("3c. scoreModel: >= MIN_OBSERVATIONS → uses measured values", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const model = makeModel("model-m", 1)

        seedSuccesses(tracker, "model-m", MIN_OBSERVATIONS, 500)

        const { components } = engine.scoreModel(model, tracker)
        assert.equal(components.coldStart, false)
        assert.equal(components.successScore, 1.0)        // all successes
        assert.equal(components.latencyScore, 1.0)        // 500ms ≤ LATENCY_BEST_MS
    })

    await t.test("3d. scoreModel: unhealthy model gets healthScore=0.0", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker({ failureThreshold: 3 })
        const model = makeModel("sick-model", 1)

        // Trigger circuit breaker
        seedFailures(tracker, "sick-model", 3)

        const { components } = engine.scoreModel(model, tracker)
        assert.equal(components.healthScore, 0.0)
    })

    await t.test("3e. scoreModel: healthy model gets healthScore=1.0", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const model = makeModel("healthy-model", 1)
        const { components } = engine.scoreModel(model, tracker)
        assert.equal(components.healthScore, 1.0)
    })

    await t.test("3f. scoreModel: score is clamped to [0.0, 1.0]", () => {
        // Use weights that would overflow if not clamped
        const engine = new RoutingEngine({
            weights: { success: 2.0, latency: 0.0, health: 0.0, availability: 0.0 }
        })
        const tracker = new ModelHealthTracker()
        const model = makeModel("overflow-model", 1)

        const { score } = engine.scoreModel(model, tracker)
        assert.ok(score <= 1.0, `Score should be clamped ≤ 1.0, got ${score}`)
        assert.ok(score >= 0.0, `Score should be ≥ 0.0, got ${score}`)
    })

    await t.test("3g. scoreModel: high latency model scores lower than low latency model", () => {
        const engine = new RoutingEngine({ minObservations: 1 })
        const tracker = new ModelHealthTracker({ historyWindow: 30 })
        const fast = makeModel("fast-model", 1)
        const slow = makeModel("slow-model", 2)

        seedSuccesses(tracker, "fast-model", 5, 500)   // 500ms avg
        seedSuccesses(tracker, "slow-model", 5, 6500)  // 6500ms avg

        const fastScore = engine.scoreModel(fast, tracker).score
        const slowScore = engine.scoreModel(slow, tracker).score
        assert.ok(fastScore > slowScore, `Fast model (${fastScore}) should outscore slow model (${slowScore})`)
    })

    await t.test("3h. scoreModel: 100% success rate scores higher than 50%", () => {
        const engine = new RoutingEngine({ minObservations: 4 })
        const tracker = new ModelHealthTracker({ historyWindow: 30 })
        const reliable = makeModel("reliable-model", 1)
        const unreliable = makeModel("unreliable-model", 2)

        seedSuccesses(tracker, "reliable-model", 4, 500)
        // 2 success + 2 failures = 50% success rate
        seedSuccesses(tracker, "unreliable-model", 2, 500)
        seedFailures(tracker, "unreliable-model", 2)

        const rScore = engine.scoreModel(reliable, tracker).score
        const uScore = engine.scoreModel(unreliable, tracker).score
        assert.ok(rScore > uScore, `Reliable (${rScore}) should outscore unreliable (${uScore})`)
    })

    // ── 4. selectBestModel ─────────────────────────────────────────────────────
    await t.test("4a. selectBestModel: returns null when no eligible models exist", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const { model } = engine.selectBestModel([], new Set(), tracker)
        assert.equal(model, null)
    })

    await t.test("4b. selectBestModel: skips models already in attemptedModels", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const models = [makeModel("a", 1), makeModel("b", 2)]
        const attempted = new Set(["a"])

        const { model } = engine.selectBestModel(models, attempted, tracker)
        assert.equal(model.id, "b")
    })

    await t.test("4c. selectBestModel: skips disabled models", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const models = [
            makeModel("disabled-model", 1, { enabled: false }),
            makeModel("enabled-model", 2, { enabled: true })
        ]
        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model.id, "enabled-model")
    })

    await t.test("4d. selectBestModel: skips isFinalFallback models", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const models = [
            makeModel("final-fallback", 1, { isFinalFallback: true }),
            makeModel("primary-model", 2, { isFinalFallback: false })
        ]
        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model.id, "primary-model")
    })

    await t.test("4e. selectBestModel: skips unhealthy (circuit-broken) models", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker({ failureThreshold: 3 })
        const models = [makeModel("sick", 1), makeModel("healthy", 2)]

        seedFailures(tracker, "sick", 3)

        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model.id, "healthy")
    })

    await t.test("4f. selectBestModel: picks highest-scoring model (not necessarily lowest priority number)", () => {
        const engine = new RoutingEngine({ minObservations: 3 })
        const tracker = new ModelHealthTracker({ historyWindow: 30 })

        // p1 has priority 1 but terrible latency → lower score
        // p2 has priority 2 but excellent latency and perfect success rate → higher score
        const models = [
            makeModel("p1", 1),
            makeModel("p2", 2)
        ]

        seedSuccesses(tracker, "p1", 5, 6800)   // ~0.0 latency score (near WORST_MS)
        seedSuccesses(tracker, "p2", 5, 400)    // 1.0 latency score

        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model.id, "p2", "Higher-scoring p2 should be selected even though p1 has lower priority number")
    })

    await t.test("4g. selectBestModel: ties broken by priority (lower number wins)", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        // Both cold-start → identical scores, tie broken by priority
        const models = [makeModel("b", 2), makeModel("a", 1)]

        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model.id, "a", "Tie should be broken in favor of model with lower priority number")
    })

    await t.test("4h. selectBestModel: returns scored array with all eligible candidates", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const models = [makeModel("x", 1), makeModel("y", 2), makeModel("z", 3)]

        const { scored } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(scored.length, 3)
        // Scored array is sorted descending by score — verify ordering invariant
        for (let i = 0; i < scored.length - 1; i++) {
            assert.ok(
                scored[i].score >= scored[i + 1].score,
                `scored[${i}].score (${scored[i].score}) should be >= scored[${i + 1}].score (${scored[i + 1].score})`
            )
        }
    })

    await t.test("4i. selectBestModel: all attempted → returns null", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker()
        const models = [makeModel("a", 1), makeModel("b", 2)]
        const attempted = new Set(["a", "b"])

        const { model } = engine.selectBestModel(models, attempted, tracker)
        assert.equal(model, null)
    })

    await t.test("4j. selectBestModel: all unhealthy → returns null", () => {
        const engine = new RoutingEngine()
        const tracker = new ModelHealthTracker({ failureThreshold: 1 })
        const models = [makeModel("a", 1), makeModel("b", 2)]

        seedFailures(tracker, "a", 1)
        seedFailures(tracker, "b", 1)

        const { model } = engine.selectBestModel(models, new Set(), tracker)
        assert.equal(model, null)
    })

    // ── 5. Integration with AIGateway ──────────────────────────────────────────
    await t.test("5a. AIGateway uses RoutingEngine: selects highest-scoring model at request time", async () => {
        const { AIGateway } = require("../src/services/ai/ai.gateway")
        const { ModelRegistry } = require("../src/services/ai/model.registry")
        const { ModelHealthTracker } = require("../src/services/ai/model.health")
        const { RoutingEngine } = require("../src/services/ai/routing.engine")
        const { ProviderRegistry } = require("../src/services/ai/provider.registry")
        const { AIProvider } = require("../src/services/ai/provider.interface")

        class MockProvider extends AIProvider {
            constructor(name) { super(name, "mock-model"); this._calls = 0 }
            isAvailable() { return true }
            async generateInterviewReport() {
                this._calls++
                return { title: "Test", matchScore: 90, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [] }
            }
        }

        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        const mh = new ModelHealthTracker({ historyWindow: 30 })
        const re = new RoutingEngine({ minObservations: 3 })
        const pr = new ProviderRegistry()
        const mock = new MockProvider("gemini")
        pr.registerProvider("gemini", mock)

        mr.clear()
        mr.registerModel({ id: "fast-model", provider: "gemini", model: "gemini-fast", priority: 1, enabled: true , verified: true })
        mr.registerModel({ id: "slow-model", provider: "gemini", model: "gemini-slow", priority: 2, enabled: true , verified: true })

        // Make fast-model actually fast and slow-model slow
        for (let i = 0; i < 5; i++) mh.recordSuccess("fast-model", 400)
        for (let i = 0; i < 5; i++) mh.recordSuccess("slow-model", 6800)

        const gateway = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        let selectedModel = null
        await gateway.execute("test-task", (provider, opts) => {
            selectedModel = opts.model
            return Promise.resolve({ title: "T", matchScore: 90, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [] })
        })

        assert.equal(selectedModel, "gemini-fast", "AIGateway should dynamically select the faster model")
    })

    await t.test("5b. AIGateway uses RoutingEngine: falls back to finalFallback after all primary models fail", async () => {
        const { AIGateway } = require("../src/services/ai/ai.gateway")
        const { ModelRegistry } = require("../src/services/ai/model.registry")
        const { ModelHealthTracker } = require("../src/services/ai/model.health")
        const { RoutingEngine } = require("../src/services/ai/routing.engine")
        const { ProviderRegistry } = require("../src/services/ai/provider.registry")
        const { AIProvider } = require("../src/services/ai/provider.interface")

        class AlwaysFailProvider extends AIProvider {
            constructor() { super("gemini", "fail-model") }
            isAvailable() { return true }
            async generateInterviewReport() { throw Object.assign(new Error("Server Error"), { code: "PROVIDER_UNAVAILABLE", status: 503 }) }
        }

        class FallbackProvider extends AIProvider {
            constructor() { super("openrouter", "free-model") }
            isAvailable() { return true }
            async generateInterviewReport() {
                return { title: "Fallback Result", matchScore: 70, technicalQuestions: [], behavioralQuestions: [], skillGaps: [], preparationPlan: [] }
            }
        }

        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        const mh = new ModelHealthTracker()
        const re = new RoutingEngine()
        const pr = new ProviderRegistry()
        pr.registerProvider("gemini", new AlwaysFailProvider())
        pr.registerProvider("openrouter", new FallbackProvider())

        mr.clear()
        mr.registerModel({ id: "primary-1", provider: "gemini", model: "g-flash", priority: 1, enabled: true , verified: true })
        mr.registerModel({ id: "openrouter-free", provider: "openrouter", model: "free-model", priority: 999, enabled: true, isFinalFallback: true , verified: true })

        const gateway = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        const result = await gateway.execute("test-fallback", (provider, opts) => provider.generateInterviewReport({}, opts))
        assert.equal(result.title, "Fallback Result")
    })

    // ── 6. Custom weight configuration ────────────────────────────────────────
    await t.test("6. Custom weight configuration: latency-dominant routing", () => {
        // With latency weight = 0.95, a fast model should heavily outscore a slow one
        const engine = new RoutingEngine({
            weights: { success: 0.02, latency: 0.95, health: 0.02, availability: 0.01 },
            minObservations: 1
        })
        const tracker = new ModelHealthTracker({ historyWindow: 30 })
        const fast = makeModel("fast", 2)
        const slow = makeModel("slow", 1)

        seedSuccesses(tracker, "fast", 2, 300)
        seedSuccesses(tracker, "slow", 2, 6900)

        // fast (priority 2) should beat slow (priority 1) when latency dominates
        const { model } = engine.selectBestModel([slow, fast], new Set(), tracker)
        assert.equal(model.id, "fast")
    })

    // ── 7. scoreModel components breakdown ────────────────────────────────────
    await t.test("7. scoreModel returns verifiable component breakdown", () => {
        const engine = new RoutingEngine({ minObservations: 2 })
        const tracker = new ModelHealthTracker({ historyWindow: 30 })
        const model = makeModel("verify-model", 1)

        // 2 successes at 2000ms → successRate = 1.0, avgLatency = 2000ms
        seedSuccesses(tracker, "verify-model", 2, 2000)

        const { score, components } = engine.scoreModel(model, tracker)
        assert.equal(components.coldStart, false)
        assert.equal(components.successScore, 1.0)
        // latency: (7000 - 2000) / (7000 - 1000) = 5000/6000 ≈ 0.8333
        const expectedLatency = (7000 - 2000) / (7000 - 1000)
        assert.ok(Math.abs(components.latencyScore - expectedLatency) < 1e-9,
            `Expected latencyScore ~${expectedLatency}, got ${components.latencyScore}`)
        assert.equal(components.healthScore, 1.0)
        assert.equal(components.availabilityScore, 1.0)
        assert.equal(components.avgLatencyMs, 2000)
        assert.equal(components.rawSuccessRate, 1.0)

        const expected = 0.45 * 1.0 + 0.30 * expectedLatency + 0.20 * 1.0 + 0.05 * 1.0
        assert.ok(Math.abs(score - expected) < 1e-9, `Expected score ~${expected}, got ${score}`)
    })
})
