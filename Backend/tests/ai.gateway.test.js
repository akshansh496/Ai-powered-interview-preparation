const test = require("node:test")
const assert = require("node:assert/strict")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { RoutingEngine } = require("../src/services/ai/routing.engine")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, model = "mock-v1", isAvailable = true) {
        super(name, model)
        this._available = isAvailable
        this.callCount = 0
    }

    isAvailable() {
        return this._available
    }

    setAvailable(flag) {
        this._available = flag
    }

    async generateInterviewReport(data) {
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

test("AIGateway - Dynamic Provider Selection & Execution tests", async (t) => {

    await t.test("should dynamically select and execute with the highest scoring available provider", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", true)
        const grok = new MockProvider("grok", "grok-2-latest", true)
        const openrouter = new MockProvider("openrouter", "openrouter/free", true)

        registry.registerProvider("gemini", gemini)
        registry.registerProvider("grok", grok)
        registry.registerProvider("openrouter", openrouter)

        // Give gemini higher success telemetry
        for (let i = 0; i < 5; i++) engine.recordSuccess("gemini", 400)
        for (let i = 0; i < 5; i++) engine.recordSuccess("grok", 900)

        const result = await gateway.execute("generateInterviewReport", (p) => p.generateInterviewReport({}))
        assert.equal(result.title, "Software Engineer")
        assert.equal(gemini.callCount, 1)
        assert.equal(grok.callCount, 0)
    })

    await t.test("should throw PROVIDER_UNAVAILABLE when all registered providers are unavailable", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", false)
        const grok = new MockProvider("grok", "grok-2-latest", false)
        const openrouter = new MockProvider("openrouter", "openrouter/free", false)

        registry.registerProvider("gemini", gemini)
        registry.registerProvider("grok", grok)
        registry.registerProvider("openrouter", openrouter)

        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", (p) => p.generateInterviewReport({})),
            (err) => err.code === "PROVIDER_UNAVAILABLE"
        )
    })
})

test("AIGateway - Dynamic Fallback and Resilience tests", async (t) => {

    await t.test("should dynamically fallback to secondary provider when primary returns transient 503", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", true)
        const grok = new MockProvider("grok", "grok-2-latest", true)

        // Make gemini the initial favorite
        for (let i = 0; i < 10; i++) engine.recordSuccess("gemini", 300)

        registry.registerProvider("gemini", gemini)
        registry.registerProvider("grok", grok)

        let geminiAttempts = 0
        let grokAttempts = 0

        const result = await gateway.execute("generateInterviewReport", async (provider) => {
            if (provider.name === "gemini") {
                geminiAttempts++
                const err = new Error("Gemini 503 Service Unavailable")
                err.status = 503
                throw err
            }
            if (provider.name === "grok") {
                grokAttempts++
                return {
                    title: "Backend Engineer",
                    matchScore: 95,
                    technicalQuestions: [],
                    behavioralQuestions: [],
                    skillGaps: [],
                    preparationPlan: []
                }
            }
        })

        assert.equal(result.title, "Backend Engineer")
        assert.equal(geminiAttempts, 1)
        assert.equal(grokAttempts, 1)
    })

    await t.test("should NOT fallback on non-transient validation errors (VALIDATION_ERROR)", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", true)
        const grok = new MockProvider("grok", "grok-2-latest", true)

        registry.registerProvider("gemini", gemini)
        registry.registerProvider("grok", grok)

        let grokCalled = false

        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", async (provider) => {
                if (provider.name === "gemini") {
                    const valErr = new Error("Schema validation failed")
                    valErr.code = "VALIDATION_ERROR"
                    throw valErr
                }
                grokCalled = true
                return {}
            }),
            (err) => err.code === "VALIDATION_ERROR"
        )

        assert.equal(grokCalled, false, "Fallback must not occur on non-transient validation errors")
    })

    await t.test("should dynamically exclude rate-limited (429) provider from subsequent requests", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine({ rateLimitCooldownMs: 5000 })
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", true)
        const openrouter = new MockProvider("openrouter", "openrouter/free", true)

        registry.registerProvider("gemini", gemini)
        registry.registerProvider("openrouter", openrouter)

        // Request 1: Gemini fails with 429 -> OpenRouter fallback handles it
        const res1 = await gateway.execute("generateInterviewReport", async (provider) => {
            if (provider.name === "gemini") {
                const err = new Error("Quota exceeded")
                err.status = 429
                throw err
            }
            return { title: "Handled by OpenRouter" }
        })
        assert.equal(res1.title, "Handled by OpenRouter")

        // Request 2: Gateway should immediately pick OpenRouter since Gemini is in rate-limit cooldown
        let selectedProviderName = null
        const res2 = await gateway.execute("generateInterviewReport", async (provider) => {
            selectedProviderName = provider.name
            return { title: "Second Request" }
        })

        assert.equal(res2.title, "Second Request")
        assert.equal(selectedProviderName, "openrouter", "Gemini should be skipped due to active rate-limit cooldown")
    })
})

test("AIGateway - Observability & Logging Banners tests", async (t) => {

    await t.test("should print AI GATEWAY and AI RESPONSE GENERATED banners", async () => {
        const registry = new ProviderRegistry()
        const engine = new RoutingEngine()
        const gateway = new AIGateway({ registry, routingEngine: engine })

        const gemini = new MockProvider("gemini", "gemini-3-flash-preview", true)
        registry.registerProvider("gemini", gemini)

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
