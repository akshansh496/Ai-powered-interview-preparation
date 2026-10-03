"use strict"
/**
 * ai.model.selection.test.js
 *
 * Tests for:
 *  1.  Auto mode selects via RoutingEngine
 *  2.  Manual mode executes requested healthy model
 *  3.  Manual mode does not invoke dynamic routing
 *  4.  Manual mode does not fall back silently
 *  5.  Manual unavailable model returns MODEL_UNAVAILABLE
 *  6.  Unknown model returns MODEL_NOT_FOUND
 *  7.  Unverified model cannot be manually selected
 *  8.  Final response metadata contains actual successful model
 *  9.  Fallback response metadata contains final successful model
 *  10. selectionMode=auto for gateway routing
 *  11. selectionMode=manual for explicit model selection
 *  12. Model status endpoint returns registry models
 *  13. API keys are never exposed
 *  17. Existing AI response schema remains unchanged
 *  18. Existing routing tests continue passing (routing engine path)
 *  20. Latency instrumentation does not change response behavior
 */

const { AIGateway }           = require("../src/services/ai/ai.gateway")
const { ModelRegistry }       = require("../src/services/ai/model.registry")
const { ModelHealthTracker }  = require("../src/services/ai/model.health")
const { RoutingEngine }       = require("../src/services/ai/routing.engine")
const { ProviderRegistry }    = require("../src/services/ai/provider.registry")

// ─── Factory helpers ────────────────────────────────────────────────────────

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
    const mr    = new ModelRegistry({ defaultTimeoutMs: 8000 })
    mr.clear()
    for (const m of models) mr.registerModel(m)

    const pr = new ProviderRegistry()
    for (const [name, prov] of Object.entries(providers)) {
        pr.registerProvider(name, prov)
    }

    const mh = new ModelHealthTracker(healthOpts)
    const re = new RoutingEngine()

    return new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })
}

const BASE_MODEL = {
    id:             "primary",
    provider:       "gemini",
    model:          "gemini-3.1-flash-lite",
    priority:       1,
    enabled:        true,
    verified:       true,
    timeoutMs:      8000,
    isFinalFallback: false
}
const SECONDARY_MODEL = {
    id:             "secondary",
    provider:       "gemini",
    model:          "gemini-3.1-flash-lite-preview",
    priority:       2,
    enabled:        true,
    verified:       true,
    timeoutMs:      8000,
    isFinalFallback: false
}
const FALLBACK_MODEL = {
    id:             "final-fallback",
    provider:       "openrouter",
    model:          "openrouter/free",
    priority:       999,
    enabled:        true,
    verified:       true,
    timeoutMs:      8000,
    isFinalFallback: true
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Model Selection — AUTO mode (Tests 1, 10, 8, 20)", () => {
    it("Test 1 — Auto mode selects via RoutingEngine and returns { data, metadata }", async () => {
        const prov = makeProvider({ result: { reportField: "value" } })
        const gw = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: prov, openrouter: makeProvider() }
        )
        const fn = (provider, opts) => provider.generateInterviewReport({}, opts)
        const result = await gw.execute("generateInterviewReport", fn)
        expect(result).toHaveProperty("data")
        expect(result).toHaveProperty("metadata")
        expect(result.data).toEqual({ reportField: "value" })
    })

    it("Test 10 — selectionMode is 'auto' for gateway routing", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        expect(metadata.selectionMode).toBe("auto")
    })

    it("Test 8 — metadata.model reflects the actual successful model", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        expect(metadata.model).toBe("gemini-3.1-flash-lite")
        expect(metadata.provider).toBe("gemini")
    })

    it("Test 20 — Latency instrumentation: metadata has numeric timing fields", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        expect(typeof metadata.totalRequestMs).toBe("number")
        expect(typeof metadata.providerRequestMs).toBe("number")
        expect(typeof metadata.routingDecisionMs).toBe("number")
        expect(metadata.totalRequestMs).toBeGreaterThan(0)
        // Latency instrumentation must not affect response data
        expect(metadata).not.toHaveProperty("apiKey")
        expect(metadata).not.toHaveProperty("prompt")
    })
})

describe("Model Selection — Fallback metadata (Test 9)", () => {
    it("Test 9 — metadata contains the final successful model after fallback", async () => {
        let callCount = 0
        const failProv = {
            name: "gemini",
            isAvailable() { return true },
            async generateInterviewReport() {
                callCount++
                const e = new Error("Overloaded")
                e.status = 503
                throw e
            }
        }
        const succProv = makeProvider({ result: { fallbackResult: true } })

        const gw = makeGateway(
            [BASE_MODEL, SECONDARY_MODEL, FALLBACK_MODEL],
            { gemini: failProv, openrouter: succProv }
        )

        // openrouter-fallback uses openrouter provider which succeeds
        const { data, metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        expect(data).toEqual({ fallbackResult: true })
        // The final model used is the openrouter final fallback
        expect(metadata.provider).toBe("openrouter")
        expect(metadata.fallbackCount).toBeGreaterThan(0)
        expect(metadata.selectionMode).toBe("auto")
    })
})

describe("Model Selection — MANUAL mode (Tests 2, 3, 4, 11)", () => {
    it("Test 2 — Manual mode executes the requested healthy model", async () => {
        const prov = makeProvider({ result: { manualResult: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const result = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        expect(result.data).toEqual({ manualResult: true })
        expect(result.metadata.model).toBe("gemini-3.1-flash-lite")
    })

    it("Test 3 — Manual mode does not invoke dynamic routing (selectBestModel not called)", async () => {
        const re = new RoutingEngine()
        const selectSpy = jest.spyOn(re, "selectBestModel")

        const prov = makeProvider({ result: { ok: true } })
        const mr   = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const pr = new ProviderRegistry()
        pr.registerProvider("gemini", prov)
        pr.registerProvider("openrouter", makeProvider())
        const mh = new ModelHealthTracker()
        const gw = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        expect(selectSpy).not.toHaveBeenCalled()
        selectSpy.mockRestore()
    })

    it("Test 4 — Manual mode does not fall back silently when model fails", async () => {
        const failProv = {
            name: "gemini", isAvailable() { return true },
            async generateInterviewReport() {
                const e = new Error("Transient error")
                e.status = 503
                throw e
            }
        }
        const succProv = makeProvider({ result: { ok: true } })
        const gw = makeGateway(
            [BASE_MODEL, SECONDARY_MODEL, FALLBACK_MODEL],
            { gemini: failProv, openrouter: succProv }
        )
        // MANUAL mode — should throw, NOT silently succeed via another model
        await expect(
            gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        ).rejects.toThrow()
    })

    it("Test 11 — selectionMode is 'manual' for explicit model selection", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        expect(metadata.selectionMode).toBe("manual")
        expect(metadata.fallbackCount).toBe(0)
    })
})

describe("Model Validation — Errors (Tests 5, 6, 7)", () => {
    it("Test 5 — Unavailable (circuit-broken) model returns MODEL_UNAVAILABLE", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway(
            [BASE_MODEL, FALLBACK_MODEL],
            { gemini: prov, openrouter: makeProvider() },
            { failureThreshold: 1, cooldownMs: 60000 }
        )
        // Trip the circuit breaker on BASE_MODEL
        gw.modelHealth.recordFailure(BASE_MODEL.id, new Error("forced"), 0)

        let err
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")
        } catch (e) {
            err = e
        }
        expect(err).toBeDefined()
        expect(err.code).toBe("MODEL_UNAVAILABLE")
        expect(err.statusCode).toBe(503)
        expect(err.model).toBe("gemini-3.1-flash-lite")
    })

    it("Test 6 — Unknown model returns MODEL_NOT_FOUND", async () => {
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: makeProvider(), openrouter: makeProvider() })
        let err
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gpt-999-notreal")
        } catch (e) {
            err = e
        }
        expect(err).toBeDefined()
        expect(err.code).toBe("MODEL_NOT_FOUND")
        expect(err.statusCode).toBe(404)
    })

    it("Test 7 — Unverified model cannot be manually selected", async () => {
        const unverifiedModel = { ...BASE_MODEL, id: "unverified", model: "unverified-model", verified: false }
        const gw = makeGateway(
            [unverifiedModel, FALLBACK_MODEL],
            { gemini: makeProvider(), openrouter: makeProvider() }
        )
        let err
        try {
            await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "unverified-model")
        } catch (e) {
            err = e
        }
        expect(err).toBeDefined()
        expect(err.code).toBe("MODEL_NOT_FOUND")
    })
})

describe("Model Status Endpoint (Test 12)", () => {
    it("Test 12 — Model status endpoint returns registry models without exposing keys", () => {
        const mr = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(SECONDARY_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const mh = new ModelHealthTracker()

        // Replicate what getAvailableModelsController does
        const eligible = mr.getEligiblePrimaryModels()
        expect(eligible).toHaveLength(2) // BASE_MODEL + SECONDARY_MODEL

        const modelList = eligible.map(m => {
            const health = mh.getHealth(m.id)
            return { id: m.model, available: m.enabled, healthy: health.healthy }
        })

        expect(modelList[0].id).toBe("gemini-3.1-flash-lite")
        expect(modelList[0].available).toBe(true)
        expect(modelList[0].healthy).toBe(true)
        // No keys exposed
        modelList.forEach(m => {
            expect(JSON.stringify(m)).not.toMatch(/api[_-]?key/i)
            expect(JSON.stringify(m)).not.toMatch(/sk-or/)
            expect(JSON.stringify(m)).not.toMatch(/AIzaSy/)
        })
    })
})

describe("Security (Test 13)", () => {
    it("Test 13 — API keys are never in metadata", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))

        const metaStr = JSON.stringify(metadata)
        expect(metaStr).not.toMatch(/api[_-]?key/i)
        expect(metaStr).not.toMatch(/sk-or/)
        expect(metaStr).not.toMatch(/AIzaSy/)
        expect(metaStr).not.toMatch(/GOOGLE_GENAI_API_KEY/i)
        expect(metaStr).not.toMatch(/OPENROUTER_API_KEY/i)
    })

    it("Test 13b — Manual mode metadata does not expose API keys", async () => {
        const prov = makeProvider({ result: { ok: true } })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { metadata } = await gw.executeManual("t", (p, o) => p.generateInterviewReport({}, o), "gemini-3.1-flash-lite")

        const metaStr = JSON.stringify(metadata)
        expect(metaStr).not.toMatch(/api[_-]?key/i)
        expect(metaStr).not.toMatch(/sk-or/)
        expect(metaStr).not.toMatch(/AIzaSy/)
    })
})

describe("Schema Preservation (Test 17)", () => {
    it("Test 17 — Existing AI response schema is in result.data, not modified", async () => {
        const aiResponse = { matchScore: 92, technicalQuestions: [], roadmap: [] }
        const prov = makeProvider({ result: aiResponse })
        const gw = makeGateway([BASE_MODEL, FALLBACK_MODEL], { gemini: prov, openrouter: makeProvider() })
        const { data } = await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        // Data is unchanged from what the provider returned
        expect(data).toEqual(aiResponse)
        // No metadata injected into data
        expect(data).not.toHaveProperty("metadata")
        expect(data).not.toHaveProperty("requestId")
    })
})

describe("Routing Engine integration (Test 18)", () => {
    it("Test 18 — RoutingEngine.selectBestModel is called in AUTO mode", async () => {
        const re = new RoutingEngine()
        const selectSpy = jest.spyOn(re, "selectBestModel")

        const prov = makeProvider({ result: { ok: true } })
        const mr   = new ModelRegistry({ defaultTimeoutMs: 8000 })
        mr.clear()
        mr.registerModel(BASE_MODEL)
        mr.registerModel(FALLBACK_MODEL)
        const pr = new ProviderRegistry()
        pr.registerProvider("gemini", prov)
        pr.registerProvider("openrouter", makeProvider())
        const mh = new ModelHealthTracker()
        const gw = new AIGateway({ registry: pr, modelRegistry: mr, modelHealth: mh, routingEngine: re })

        await gw.execute("t", (p, o) => p.generateInterviewReport({}, o))
        expect(selectSpy).toHaveBeenCalled()
        selectSpy.mockRestore()
    })
})
