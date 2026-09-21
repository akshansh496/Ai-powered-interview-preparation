const { AIProvider } = require("./provider.interface")
const geminiProvider = require("./gemini.provider")
const grokProvider = require("./grok.provider")
const openrouterProvider = require("./openrouter.provider")

/**
 * Central registry mapping provider identifiers to AIProvider instances.
 */
class ProviderRegistry {
    constructor() {
        this.providers = new Map()
        // Register default supported providers
        this.registerProvider("gemini", geminiProvider)
        this.registerProvider("grok", grokProvider)
        this.registerProvider("openrouter", openrouterProvider)
    }

    /**
     * Registers a new or mock provider into the central registry.
     * @param {string} name - Provider identifier (e.g. 'gemini', 'grok', 'openai')
     * @param {AIProvider} provider - Instance conforming to AIProvider contract
     */
    registerProvider(name, provider) {
        if (!name || typeof name !== "string") {
            throw new Error("Provider name must be a non-empty string.")
        }
        if (!provider || typeof provider.generateInterviewReport !== "function") {
            throw new Error(`Provider '${name}' must implement the AIProvider interface.`)
        }
        this.providers.set(name.toLowerCase(), provider)
    }

    /**
     * Retrieves a provider by name from the registry.
     * Throws a CONFIGURATION_ERROR if the provider is unknown.
     * @param {string} name
     * @returns {AIProvider}
     */
    getProvider(name) {
        const normalized = (name || "").toLowerCase()
        const provider = this.providers.get(normalized)
        if (!provider) {
            const error = new Error(`Configured AI provider '${name}' is not registered or supported.`)
            error.code = "CONFIGURATION_ERROR"
            throw error
        }
        return provider
    }

    /**
     * Checks if a provider exists in the registry.
     * @param {string} name
     * @returns {boolean}
     */
    hasProvider(name) {
        return this.providers.has((name || "").toLowerCase())
    }

    /**
     * Returns an array of registered provider names.
     * @returns {string[]}
     */
    getRegisteredNames() {
        return Array.from(this.providers.keys())
    }

    /**
     * Returns an array of all registered provider instances.
     * @returns {AIProvider[]}
     */
    getAllProviders() {
        return Array.from(this.providers.values())
    }
}

const providerRegistry = new ProviderRegistry()

module.exports = providerRegistry
module.exports.ProviderRegistry = ProviderRegistry
