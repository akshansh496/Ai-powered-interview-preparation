"use strict"
/**
 * ai.model.selection.test.js
 *
 * Tests for Model Selection UI + Latency Instrumentation feature.
 * Uses Node.js native test runner (node:test + node:assert/strict).
 *
 * Covers:
 *  Test 1  — Auto mode selects via RoutingEngine → returns { data, metadata }
 *  Test 2  — Manual mode executes the requested healthy model
 *  Test 3  — Manual mode does NOT invoke RoutingEngine.selectBestModel
 *  Test 4  — Manual mode does NOT silently fall back on transient error
 *  Test 5  — Unavailable (circuit-broken) model → MODEL_UNAVAILABLE
 *  Test 6  — Unknown model → MODEL_NOT_FOUND
 *  Test 7  — Unverified model cannot be manually selected → MODEL_NOT_FOUND
 *  Test 8  — Auto metadata.model reflects the actual successful model
 *  Test 9  — After fallback, metadata contains final successful model
 *  Test 10 — selectionMode = "auto" for gateway routing
 *  Test 11 — selectionMode = "manual" for manual model selection
 *  Test 12 — Model status logic: getEligiblePrimaryModels excludes final fallback
 *  Test 13 — API keys are never in metadata (security)
 *  Test 17 — Existing AI response schema is in result.data, not modified
 *  Test 18 — RoutingEngine.selectBestModel is called in AUTO mode
 *  Test 20 — Latency instrumentation: metadata has numeric timing fields
 */

const test   = require("node:test")
const assert = require("node:assert/strict")

const { AIGateway }          = require("../src/services/ai/ai.gateway")
const { ModelRegistry }      = require("../src/services/ai/model.registry")
const { ModelHealthTracker } = require("../src/services/ai/model.health")
const { RoutingEngine }      = require("../src/services/ai/routing.engine")
const { ProviderRegistry }   = require("../src/services/ai/provider.registry")

// ─── Factory helpers ─────────────────────────────────────────────────────────

function makeProvider(opts = {}) {
    return {
        name:       opts.name || "mockProvider",
        model:      opts.model || "mock-model",
        isAvailable() { return opts.available !== false },
        async generateInterviewReport(_, __) {
            if (opts.fail) throw opts.fail
            return opts.result || { mockField: "ok" }
        },
        async generateResumePdf(_, __) {
            if (opts.fail) throw opts.fail
            return opts.html || "<html>ok</html>"
        }
    }
}

function makeGateway(models, providers, healthOpts = {}) {
    const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
    mr.clear()
    for (const m of models) mr.registerModel(m)

    const pr = new ProviderRegistry()
    for (const [name, prov] of Object.entries(providers)) {
        pr.registerProvider(name, prov)
    }

    const mh = new ModelHealthTracker(healthOpts)
    const re = new RoutingEngine()

    return { gw: new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re }), mh, re, mr }
}

// Shared model definitions
const BASE_MODEL = {
    id: "primary", provider: "gemini", model: "gemini-3.1-flash-lite",
    priority: 1, enabled: true, verified: true, timeoutMs: 8000, isFinalFallback: false
}
const SECONDARY_MODEL = {
    id: "secondary", provider: "gemini", model: "gemini-3.1-flash-lite-preview",
    priority: 2, enabled: true, verified: true, timeoutMs: 8000, isFinalFallback: false
}
const FALLBACK_MODEL = {
    id: "final-fallback", provider: "openrouter", model: "openrouter/free",
    priority: 999, enabled: true, verified: true, timeoutMs: 8000, isFinalFallback: true
}

// ─── AUTO mode ───────────────────────────────────────────────────────────────
test("Model Selection — AUTO mode tests", async (t) => {

    await t.test("Test 1 — Auto mode returns { data, metadata }", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { reportField: "value" } }), openrouter: makeProvider() }
        )
        const fn = (p, o) => p.generateInterviewReport({}, o)
        const result = await gw.execute("generateInterviewReport", fn)

        assert.ok(result && typeof result === "object", "result must be an object")
        assert.ok("data" in result,     "result must have data")
        assert.ok("metadata" in result, "result must have metadata")
        assert.deepEqual(result.data, { reportField: "value" })
    })

    await t.test("Test 10 — selectionMode is 'auto' for gateway routing", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.equal(metadata.selectionMode, "auto")
    })

    await t.test("Test 8 — metadata.model reflects the actual successful model", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.equal(metadata.model, "gemini-3.1-flash-lite")
        assert.equal(metadata.provider, "gemini")
    })

    await t.test("Test 20 — Latency: metadata has numeric timing fields; does not expose internals", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.equal(typeof metadata.totalRequestMs,    "number", "totalRequestMs must be a number")
        assert.equal(typeof metadata.providerRequestMs, "number", "providerRequestMs must be a number")
        assert.equal(typeof metadata.routingDecisionMs, "number", "routingDecisionMs must be a number")
        assert.ok(metadata.totalRequestMs >= 0, "totalRequestMs must be non-negative")
        assert.ok(!("apiKey" in metadata), "metadata must not expose apiKey")
        assert.ok(!("prompt" in metadata),  "metadata must not expose prompt")
    })
})

// ─── Fallback metadata ───────────────────────────────────────────────────────
test("Model Selection — Fallback metadata (Test 9)", async (t) => {

    await t.test("Test 9 — After fallback, metadata contains the final successful model", async () => {
        // Gemini provider always throws 503
        const failGemini = {
            name: "gemini", isAvailable() { return true },
            async generateInterviewReport() {
                const e = new Error("Gemini overloaded")
                e.status = 503
                throw e
            }
        }
        // OpenRouter provider succeeds
        const succOpenRouter = makeProvider({ result: { fallbackResult: true } })

        const { gw } = makeGateway(
            [BASE_MODEL, SECONDARY_MODEL, FALLBACK_MODEL],
            { gemini: failGemini, openrouter: succOpenRouter }
        )

        const { data, metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.deepEqual(data, { fallbackResult: true })
        assert.equal(metadata.provider, "openrouter")
        assert.ok(metadata.fallbackCount > 0, "fallbackCount must be > 0 after fallback")
        assert.equal(metadata.selectionMode, "auto")
    })
})

// ─── MANUAL mode ─────────────────────────────────────────────────────────────
test("Model Selection — MANUAL mode tests", async (t) => {

    await t.test("Test 2 — Manual mode executes the requested healthy model", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { manualResult: true } }), openrouter: makeProvider() }
        )
        const result = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        assert.deepEqual(result.data, { manualResult: true })
        assert.equal(result.metadata.model, "gemini-3.1-flash-lite")
    })

    await t.test("Test 3 — Manual mode does NOT invoke RoutingEngine.selectBestModel", async () => {
        const re = new RoutingEngine()
        let selectBestCalled = false
        const origSelect = re.selectBestModel.bind(re)
        re.selectBestModel = (...args) => {
            selectBestCalled = true
            return origSelect(...args)
        }

        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const pr = new ProviderRegistry()
        pr.registerProvider("gemini",     makeProvider({ result: { ok: true } }))
        pr.registerProvider("openrouter", makeProvider())
        const mh = new ModelHealthTracker()
        const gw = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        assert.equal(selectBestCalled, false, "RoutingEngine.selectBestModel must NOT be called in MANUAL mode")
    })

    await t.test("Test 4 — Manual mode does NOT silently fall back on transient error", async () => {
        const failGemini = {
            name: "gemini", isAvailable() { return true },
            async generateInterviewReport() {
                const e = new Error("Transient 503")
                e.status = 503
                throw e
            }
        }
        const { gw } = makeGateway(
            [BASE_MODEL, SECONDARY_MODEL, FALLBACK_MODEL],
            { gemini: failGemini, openrouter: makeProvider({ result: { ok: true } }) }
        )

        let threw = false
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        } catch (e) {
            threw = true
        }
        assert.equal(threw, true, "MANUAL mode must throw on failure instead of silently falling back")
    })

    await t.test("Test 11 — selectionMode is 'manual' for explicit model selection", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        assert.equal(metadata.selectionMode, "manual")
        assert.equal(metadata.fallbackCount, 0)
    })
})

// ─── Model Validation Errors ──────────────────────────────────────────────────
test("Model Validation — Error codes (Tests 5, 6, 7)", async (t) => {

    await t.test("Test 5 — Circuit-broken model returns MODEL_UNAVAILABLE", async () => {
        const { gw, mh } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() },
            { failureThreshold: 1, cooldownMs: 60000 }
        )
        // Trip circuit breaker
        mh.recordFailure(BASE_MODEL.id, new Error("forced"), 0)

        let err = null
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        } catch (e) {
            err = e
        }
        assert.ok(err !== null,             "should have thrown")
        assert.equal(err.code,              "MODEL_UNAVAILABLE")
        assert.equal(err.statusCode,        503)
        assert.equal(err.model,             "gemini-3.1-flash-lite")
    })

    await t.test("Test 6 — Unknown model returns MODEL_NOT_FOUND", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider(), openrouter: makeProvider() }
        )
        let err = null
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gpt-999-notreal")
        } catch (e) {
            err = e
        }
        assert.ok(err !== null,         "should have thrown")
        assert.equal(err.code,          "MODEL_NOT_FOUND")
        assert.equal(err.statusCode,    404)
    })

    await t.test("Test 7 — Unverified model cannot be manually selected", async () => {
        const unverifiedModel = { ...BASE_MODEL, id: "unverified", model: "unverified-model", verified: false }
        const { gw } = makeGateway(
            [unverifiedModel, FALLBACK_MODEL],
            { gemini: makeProvider(), openrouter: makeProvider() }
        )
        let err = null
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "unverified-model")
        } catch (e) {
            err = e
        }
        assert.ok(err !== null,         "should have thrown")
        assert.equal(err.code,          "MODEL_NOT_FOUND", "unverified models must appear as not found to clients")
    })
})

// ─── Model Status Endpoint Logic ──────────────────────────────────────────────
test("Model Status Endpoint (Test 12)", async (t) => {
    await t.test("Test 12 — getEligiblePrimaryModels excludes final fallback, returns verified enabled only", () => {
        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(SECONDARY_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const mh = new ModelHealthTracker()

        const eligible = mr.getEligiblePrimaryModels()
        assert.equal(eligible.length, 2, "Only 2 primary eligible models (excludes final fallback)")
        assert.equal(eligible[0].id, "primary")
        assert.equal(eligible[1].id, "secondary")

        // Verify model list has no API keys
        const modelList = eligible.map(m => {
            const health = mh.getHealth(m.id)
            return { id: m.model, available: m.enabled, healthy: health.healthy }
        })
        modelList.forEach(m => {
            const str = JSON.stringify(m)
            assert.ok(!str.match(/api[_-]?key/i), "No api key in model status")
            assert.ok(!str.includes("sk-or"),      "No OpenRouter key in model status")
            assert.ok(!str.includes("AIzaSy"),     "No Google API key in model status")
        })
    })
})

// ─── Security ─────────────────────────────────────────────────────────────────
test("Security (Test 13) — API keys never in metadata", async (t) => {

    await t.test("Test 13a — Auto mode metadata has no API keys", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        const metaStr = JSON.stringify(metadata)
        assert.ok(!metaStr.match(/api[_-]?key/i),           "No apiKey in auto metadata")
        assert.ok(!metaStr.includes("sk-or"),                "No OpenRouter key in auto metadata")
        assert.ok(!metaStr.includes("AIzaSy"),               "No Google key in auto metadata")
        assert.ok(!metaStr.match(/GOOGLE_GENAI_API_KEY/i),  "No GOOGLE_GENAI_API_KEY in auto metadata")
        assert.ok(!metaStr.match(/OPENROUTER_API_KEY/i),    "No OPENROUTER_API_KEY in auto metadata")
    })

    await t.test("Test 13b — Manual mode metadata has no API keys", async () => {
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: { ok: true } }), openrouter: makeProvider() }
        )
        const { metadata } = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        const metaStr = JSON.stringify(metadata)
        assert.ok(!metaStr.match(/api[_-]?key/i),  "No apiKey in manual metadata")
        assert.ok(!metaStr.includes("sk-or"),       "No OpenRouter key in manual metadata")
        assert.ok(!metaStr.includes("AIzaSy"),      "No Google key in manual metadata")
    })
})

// ─── Schema Preservation ──────────────────────────────────────────────────────
test("Schema Preservation (Test 17)", async (t) => {
    await t.test("Test 17 — result.data matches provider output exactly; no metadata injected into data", async () => {
        const aiResponse = { matchScore: 92, technicalQuestions: [], roadmap: [] }
        const { gw } = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: makeProvider({ result: aiResponse }), openrouter: makeProvider() }
        )
        const { data } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.deepEqual(data, aiResponse, "data must equal exactly what provider returned")
        assert.ok(!("metadata" in data),   "data must not have metadata key injected")
        assert.ok(!("requestId" in data),  "data must not have requestId injected")
    })
})

// ─── Routing Engine integration ───────────────────────────────────────────────
test("Routing Engine integration (Test 18)", async (t) => {
    await t.test("Test 18 — RoutingEngine.selectBestModel is called in AUTO mode", async () => {
        const re = new RoutingEngine()
        let selectBestCalled = false
        const origSelect = re.selectBestModel.bind(re)
        re.selectBestModel = (...args) => {
            selectBestCalled = true
            return origSelect(...args)
        }

        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const pr = new ProviderRegistry()
        pr.registerProvider("gemini",     makeProvider({ result: { ok: true } }))
        pr.registerProvider("openrouter", makeProvider())
        const mh = new ModelHealthTracker()
        const gw = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        assert.equal(selectBestCalled, true, "RoutingEngine.selectBestModel MUST be called in AUTO mode")
    })
})
