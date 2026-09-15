const test = require("node:test")
const assert = require("node:assert/strict")
const { ProviderRegistry } = require("../src/services/ai/provider.registry")
const { AIProvider } = require("../src/services/ai/provider.interface")
const geminiProvider = require("../src/services/ai/gemini.provider")
const grokProvider = require("../src/services/ai/grok.provider")

test("AIProvider Interface tests", async (t) => {
    await t.test("should reject direct instantiation of abstract AIProvider", () => {
        assert.throws(
            () => new AIProvider("mock", "model"),
            (err) => err instanceof TypeError && err.message.includes("Cannot instantiate abstract")
        )
    })

    await t.test("geminiProvider should conform to AIProvider interface", () => {
        assert.ok(geminiProvider instanceof AIProvider)
        assert.equal(geminiProvider.name, "gemini")
        assert.equal(typeof geminiProvider.generateInterviewReport, "function")
        assert.equal(typeof geminiProvider.generateResumePdf, "function")
        assert.equal(typeof geminiProvider.isAvailable, "function")
    })

    await t.test("grokProvider should conform to AIProvider interface", () => {
        assert.ok(grokProvider instanceof AIProvider)
        assert.equal(grokProvider.name, "grok")
        assert.equal(typeof grokProvider.generateInterviewReport, "function")
        assert.equal(typeof grokProvider.generateResumePdf, "function")
        assert.equal(typeof grokProvider.isAvailable, "function")
    })
})

test("ProviderRegistry tests", async (t) => {
    await t.test("should initialize with default gemini and grok providers", () => {
        const registry = new ProviderRegistry()
        assert.equal(registry.hasProvider("gemini"), true)
        assert.equal(registry.hasProvider("grok"), true)
        assert.equal(registry.hasProvider("nonexistent"), false)
        assert.deepEqual(registry.getRegisteredNames().sort(), ["gemini", "grok"].sort())
    })

    await t.test("should register and retrieve a valid custom provider", () => {
        const registry = new ProviderRegistry()
        class CustomProvider extends AIProvider {
            constructor() {
                super("custom", "custom-model")
            }
            isAvailable() { return true }
            async generateInterviewReport() { return {} }
            async generateResumePdf() { return "" }
        }

        const custom = new CustomProvider()
        registry.registerProvider("custom", custom)

        assert.equal(registry.hasProvider("custom"), true)
        assert.equal(registry.getProvider("custom"), custom)
    })

    await t.test("should throw error when registering invalid provider", () => {
        const registry = new ProviderRegistry()
        assert.throws(
            () => registry.registerProvider("", {}),
            (err) => err.message.includes("must be a non-empty string")
        )
        assert.throws(
            () => registry.registerProvider("invalid", {}),
            (err) => err.message.includes("must implement the AIProvider interface")
        )
    })

    await t.test("should throw CONFIGURATION_ERROR when getting unknown provider", () => {
        const registry = new ProviderRegistry()
        assert.throws(
            () => registry.getProvider("unknown_ai"),
            (err) => err.code === "CONFIGURATION_ERROR"
        )
    })
})
