const test = require("node:test")
const assert = require("node:assert/strict")
const { AIGateway } = require("../src/services/ai/ai.gateway")
const { AIRouter } = require("../src/services/ai/ai.router")
const { ModelRegistry } = require("../src/services/ai/model.registry")
const { ModelHealthTracker } = require("../src/services/ai/model.health")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { AIProvider } = require("../src/services/ai/provider.interface")

class MockProvider extends AIProvider {
    constructor(name, model = "default-model", isAvailable = true) {
        super(name, model)
        this._available = isAvailable
        this.callHistory = []
    }

    isAvailable() {
        return this._available
    }

    setAvailable(flag) {
        this._available = flag
    }

    async generateInterviewReport(data, options = {}) {
        this.callHistory.push({
            task: "generateInterviewReport",
            data,
            options
        })
        return {
            title: "Software Engineer",
            matchScore: 90,
            technicalQuestions: [],
            behavioralQuestions: [],
            skillGaps: [],
            preparationPlan: []
        }
    }
}

test("Model-Aware Routing - Unit & Resilience Test Suite", async (t) => {

    await t.test("1. Healthy model selection & 2. Priority ordering (selects lowest priority number first)", async () => {
        const modelRegistry = new ModelRegistry({ defaultTimeoutMs: 8000 })
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "model-p2", provider: "gemini", model: "gemini-secondary", priority: 2, enabled: true })
        modelRegistry.registerModel({ id: "model-p1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "model-p3", provider: "openrouter", model: "openrouter-primary", priority: 3, enabled: true })

        const geminiMock = new MockProvider("gemini")
        const openrouterMock = new MockProvider("openrouter")
        providerRegistry.registerProvider("gemini", geminiMock)
        providerRegistry.registerProvider("openrouter", openrouterMock)

        let selectedModelUsed = null
        const res = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            selectedModelUsed = opts.model
            return { title: "Priority 1 Selected" }
        })

        assert.equal(res.title, "Priority 1 Selected")
        assert.equal(selectedModelUsed, "gemini-primary", "Priority 1 model must be selected first")
    })

    await t.test("3. Disabled model skipping (skips disabled models regardless of priority)", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "model-p1-disabled", provider: "gemini", model: "gemini-primary", priority: 1, enabled: false })
        modelRegistry.registerModel({ id: "model-p2-enabled", provider: "gemini", model: "gemini-secondary", priority: 2, enabled: true })

        const geminiMock = new MockProvider("gemini")
        providerRegistry.registerProvider("gemini", geminiMock)

        let selectedModelUsed = null
        await gateway.execute("generateInterviewReport", async (provider, opts) => {
            selectedModelUsed = opts.model
            return { ok: true }
        })

        assert.equal(selectedModelUsed, "gemini-secondary", "Disabled priority 1 model must be skipped")
    })

    await t.test("4. Timeout handling & 5. Timeout causes fallback to next healthy model", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "model-a", provider: "gemini", model: "gemini-fast", priority: 1, enabled: true, timeoutMs: 100 })
        modelRegistry.registerModel({ id: "model-b", provider: "openrouter", model: "openrouter-fast", priority: 2, enabled: true, timeoutMs: 100 })

        const geminiMock = new MockProvider("gemini")
        const openrouterMock = new MockProvider("openrouter")
        providerRegistry.registerProvider("gemini", geminiMock)
        providerRegistry.registerProvider("openrouter", openrouterMock)

        const attempts = []
        const res = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            attempts.push(opts.model)
            if (opts.model === "gemini-fast") {
                const timeoutErr = new Error("Request timed out after 100ms")
                timeoutErr.code = "REQUEST_TIMEOUT"
                throw timeoutErr
            }
            return { title: "Success on fallback" }
        })

        assert.equal(res.title, "Success on fallback")
        assert.deepEqual(attempts, ["gemini-fast", "openrouter-fast"])
        assert.equal(modelHealth.getHealth("model-a").consecutiveFailures, 1)
        assert.equal(modelHealth.getHealth("model-b").totalSuccesses, 1)
    })

    await t.test("6. 5xx causes fallback & 7. Temporary failure causes fallback", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "m1", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "m2", provider: "gemini", model: "m2", priority: 2, enabled: true })
        modelRegistry.registerModel({ id: "m3", provider: "openrouter", model: "m3", priority: 3, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        const executionLog = []
        const res = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            executionLog.push(opts.model)
            if (opts.model === "m1") {
                const err500 = new Error("Internal 500 server error")
                err500.status = 500
                throw err500
            }
            if (opts.model === "m2") {
                const err429 = new Error("Rate limited 429")
                err429.status = 429
                throw err429
            }
            return { title: "m3 succeeded" }
        })

        assert.equal(res.title, "m3 succeeded")
        assert.deepEqual(executionLog, ["m1", "m2", "m3"])
    })

    await t.test("8. Same model is not retried within the same request (loop protection)", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "m1", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "m2", provider: "gemini", model: "m2", priority: 2, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))

        const attempts = []
        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", async (provider, opts) => {
                attempts.push(opts.model)
                const err = new Error("503 Service Unavailable")
                err.status = 503
                throw err
            }),
            (err) => err.code === "PROVIDER_UNAVAILABLE"
        )

        assert.deepEqual(attempts, ["m1", "m2"], "Each model must be attempted at most once")
    })

    await t.test("9. Failed model is temporarily unhealthy & 10. Three failures trigger cooldown", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker({ failureThreshold: 3, cooldownMs: 60000 })
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "model-fragile", provider: "gemini", model: "fragile-1", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "model-stable", provider: "openrouter", model: "stable-1", priority: 2, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        // Run 3 requests where fragile fails and stable rescues
        for (let i = 0; i < 3; i++) {
            await gateway.execute("generateInterviewReport", async (provider, opts) => {
                if (opts.model === "fragile-1") {
                    const err = new Error("503 Overloaded")
                    err.status = 503
                    throw err
                }
                return { success: true }
            })
        }

        const fragileHealth = modelHealth.getHealth("model-fragile")
        assert.equal(fragileHealth.consecutiveFailures, 3)
        assert.equal(fragileHealth.healthy, false, "3 failures must put model in unhealthy cooldown state")
        assert.ok(fragileHealth.temporarilyUnhealthyUntil > Date.now())

        // 4th request: fragile should NOT even be attempted
        const attempted = []
        await gateway.execute("generateInterviewReport", async (provider, opts) => {
            attempted.push(opts.model)
            return { success: true }
        })

        assert.deepEqual(attempted, ["stable-1"], "Unhealthy model in cooldown must be skipped without attempting")
    })

    await t.test("11. Healthy model after cooldown is eligible (probe allowed); RoutingEngine selects higher-scoring model", async () => {
        const modelHealth = new ModelHealthTracker({ failureThreshold: 3, cooldownMs: 50 })
        const modelRegistry = new ModelRegistry()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "m1", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "m2", provider: "openrouter", model: "m2", priority: 2, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        // Trigger cooldown on m1 (3 failures recorded → 0% recent success in rolling window)
        for (let i = 0; i < 3; i++) {
            modelHealth.recordFailure("m1", new Error("503"), 100)
        }
        assert.equal(modelHealth.isHealthy("m1"), false)

        // Wait for cooldown to expire
        await new Promise(res => setTimeout(res, 60))

        // m1 is eligible again (probe request allowed)
        assert.equal(modelHealth.isHealthy("m1"), true, "After cooldown expires, m1 is eligible for probe request")

        // RoutingEngine correctly selects m2 over m1:
        //   m1: 3 failures in rolling window (>= MIN_OBSERVATIONS), successRate=0% → low score
        //   m2: no observations, cold-start defaults → higher score
        // This is intentional — dynamic routing prefers the empirically better model
        let executed = null
        await gateway.execute("generateInterviewReport", async (p, opts) => {
            executed = opts.model
            return { ok: true }
        })

        assert.equal(executed, "m2", "RoutingEngine selects m2 (higher score) over m1 (0% recent success rate despite cooldown expiry)")
        assert.equal(modelHealth.getHealth("m2").consecutiveFailures, 0, "Success resets consecutive failure counter for selected model")
    })

    await t.test("12. OpenRouter/free is used only after individual models fail & 13. Attempted only once", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "m2", provider: "gemini", model: "gemini-secondary", priority: 2, enabled: true })
        modelRegistry.registerModel({ id: "m3", provider: "openrouter", model: "openrouter-custom", priority: 3, enabled: true })
        modelRegistry.registerModel({ id: "or-free", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, isFinalFallback: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        const attemptChain = []
        const res = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            attemptChain.push(opts.model)
            if (opts.model !== "openrouter/free") {
                const err = new Error("Model unavailable 503")
                err.status = 503
                throw err
            }
            return { title: "Rescued by openrouter/free final fallback" }
        })

        assert.equal(res.title, "Rescued by openrouter/free final fallback")
        assert.deepEqual(attemptChain, [
            "gemini-primary",
            "gemini-secondary",
            "openrouter-custom",
            "openrouter/free"
        ], "openrouter/free must be called strictly after all primary models fail")
    })

    await t.test("14. No infinite fallback loop & returns controlled error if openrouter/free also fails", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "gemini-1", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "or-free", provider: "openrouter", model: "openrouter/free", priority: 999, enabled: true, isFinalFallback: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        const attempts = []
        await assert.rejects(
            async () => await gateway.execute("generateInterviewReport", async (provider, opts) => {
                attempts.push(opts.model)
                const err = new Error("All down 503")
                err.status = 503
                throw err
            }),
            (err) => err.code === "PROVIDER_UNAVAILABLE" && err.statusCode === 503
        )

        assert.deepEqual(attempts, ["gemini-1", "openrouter/free"], "Must terminate after openrouter/free fails once")
    })

    await t.test("15. Successful first model prevents fallback calls", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "gemini", model: "gemini-primary", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "m2", provider: "openrouter", model: "openrouter-primary", priority: 2, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        const attempts = []
        const res = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            attempts.push(opts.model)
            return { title: "First Model Success" }
        })

        assert.equal(res.title, "First Model Success")
        assert.deepEqual(attempts, ["gemini-primary"])
    })

    await t.test("16. API keys and sensitive credentials are never logged", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        const secretKey = "sk-or-secret-sensitive-key-999"
        modelRegistry.clear()
        modelRegistry.registerModel({ id: "m1", provider: "openrouter", model: "m1", priority: 1, enabled: true })

        const mockProvider = new MockProvider("openrouter")
        mockProvider.apiKey = secretKey
        providerRegistry.registerProvider("openrouter", mockProvider)

        const capturedLogs = []
        const origLog = console.log
        console.log = (...args) => capturedLogs.push(args.join(" "))

        try {
            await gateway.execute("generateInterviewReport", async () => ({ title: "Done" }))
            const allLogText = capturedLogs.join("\n")
            assert.equal(allLogText.includes(secretKey), false, "Secret API keys must never appear in logs")
        } finally {
            console.log = origLog
        }
    })

    await t.test("Model A fails, Model B succeeds: verified state assertions", async () => {
        const modelRegistry = new ModelRegistry()
        const modelHealth = new ModelHealthTracker()
        const providerRegistry = new ProviderRegistry()
        const gateway = new AIGateway({ registry: providerRegistry, modelRegistry, modelHealth })

        modelRegistry.clear()
        modelRegistry.registerModel({ id: "model-a", provider: "gemini", model: "gemini-a", priority: 1, enabled: true })
        modelRegistry.registerModel({ id: "model-b", provider: "openrouter", model: "openrouter-b", priority: 2, enabled: true })

        providerRegistry.registerProvider("gemini", new MockProvider("gemini"))
        providerRegistry.registerProvider("openrouter", new MockProvider("openrouter"))

        const attempts = []
        const result = await gateway.execute("generateInterviewReport", async (provider, opts) => {
            attempts.push(opts.model)
            if (opts.model === "gemini-a") {
                const err = new Error("Gemini temporary 503")
                err.status = 503
                throw err
            }
            return { title: "Model B Succeeded" }
        })

        // Expected:
        // - A attempted once
        // - B attempted once
        // - A marked with 1 consecutive failure
        // - B response returned
        assert.deepEqual(attempts, ["gemini-a", "openrouter-b"])
        assert.equal(result.title, "Model B Succeeded")
        assert.equal(modelHealth.getHealth("model-a").consecutiveFailures, 1)
        assert.equal(modelHealth.getHealth("model-b").totalSuccesses, 1)
    })
})
