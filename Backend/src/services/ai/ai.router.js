const geminiProvider = require("./gemini.provider")
const grokProvider = require("./grok.provider")
const { AIProvider } = require("./provider.interface")
const { isTransientError } = require("./gemini.provider")

class AIRouter {
    constructor() {
        this.registry = new Map()
        // Register initial supported providers
        this.registerProvider("gemini", geminiProvider)
        this.registerProvider("grok", grokProvider)
    }

    /**
     * Registers a new or mock provider into the central registry.
     * @param {string} name - Provider identifier
     * @param {AIProvider} provider - Instance conforming to AIProvider contract
     */
    registerProvider(name, provider) {
        if (!name || typeof name !== "string") {
            throw new Error("Provider name must be a non-empty string.")
        }
        if (!provider || typeof provider.generateInterviewReport !== "function") {
            throw new Error(`Provider '${name}' must implement the AIProvider interface.`)
        }
        this.registry.set(name.toLowerCase(), provider)
    }

    /**
     * Retrieves a provider by name from the registry.
     * @param {string} name
     * @returns {AIProvider}
     */
    getProvider(name) {
        const normalized = (name || "").toLowerCase()
        const provider = this.registry.get(normalized)
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
        return this.registry.has((name || "").toLowerCase())
    }

    /**
     * Gets the configured default primary provider name.
     * @returns {string}
     */
    getDefaultProviderName() {
        return process.env.AI_DEFAULT_PROVIDER || "gemini"
    }

    /**
     * Gets the configured fallback provider name.
     * @returns {string}
     */
    getFallbackProviderName() {
        return process.env.AI_FALLBACK_PROVIDER || "grok"
    }

    /**
     * Checks whether automatic fallback is enabled.
     * @returns {boolean}
     */
    isFallbackEnabled() {
        return process.env.AI_ENABLE_FALLBACK !== "false"
    }

    /**
     * Determines whether an error qualifies for automatic provider fallback.
     * Only transient provider infrastructure failures qualify.
     */
    isEligibleForFallback(error) {
        if (!error) return false
        // Never fallback on application-level or configuration errors
        if (error.code === "CONFIGURATION_ERROR" || error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
            return false
        }
        return isTransientError(error)
    }

    /**
     * Emits a lightweight structured log for observability.
     */
    logExecution({ task, provider, model, success, latencyMs, errorCategory = null, isFallback = false }) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            task,
            provider,
            model,
            success,
            latencyMs,
            ...(isFallback ? { fallback: true } : {}),
            ...(errorCategory ? { errorCategory } : {})
        }
        console.log(`[AIRouter] ${JSON.stringify(logEntry)}`)
    }

    /**
     * Routes and executes an AI task through the selected provider with controlled fallback.
     * @param {string} taskName - Name of the task (e.g. 'generateInterviewReport', 'generateResumePdf')
     * @param {Function} executeFn - Function taking (provider) and returning a promise
     * @param {Object} [options] - Optional execution options (e.g. { provider: 'grok', model: '...' })
     */
    async route(taskName, executeFn, options = {}) {
        const primaryProviderName = options.provider || this.getDefaultProviderName()
        const primaryProvider = this.getProvider(primaryProviderName)
        const startTime = Date.now()

        try {
            const result = await executeFn(primaryProvider)
            this.logExecution({
                task: taskName,
                provider: primaryProvider.name,
                model: primaryProvider.model,
                success: true,
                latencyMs: Date.now() - startTime
            })
            return result
        } catch (primaryError) {
            const primaryLatency = Date.now() - startTime
            this.logExecution({
                task: taskName,
                provider: primaryProvider.name,
                model: primaryProvider.model,
                success: false,
                latencyMs: primaryLatency,
                errorCategory: primaryError.code || primaryError.name || "Error"
            })

            const fallbackName = this.getFallbackProviderName()
            const canFallback =
                this.isFallbackEnabled() &&
                this.hasProvider(fallbackName) &&
                fallbackName.toLowerCase() !== primaryProvider.name.toLowerCase() &&
                this.isEligibleForFallback(primaryError)

            if (!canFallback) {
                throw primaryError
            }

            console.warn(
                `[AIRouter] Primary provider '${primaryProvider.name}' failed (${primaryError.message}). Initiating fallback to '${fallbackName}'...`
            )

            const fallbackProvider = this.getProvider(fallbackName)
            const fallbackStartTime = Date.now()

            try {
                const fallbackResult = await executeFn(fallbackProvider)
                this.logExecution({
                    task: taskName,
                    provider: fallbackProvider.name,
                    model: fallbackProvider.model,
                    success: true,
                    latencyMs: Date.now() - fallbackStartTime,
                    isFallback: true
                })
                return fallbackResult
            } catch (fallbackError) {
                this.logExecution({
                    task: taskName,
                    provider: fallbackProvider.name,
                    model: fallbackProvider.model,
                    success: false,
                    latencyMs: Date.now() - fallbackStartTime,
                    errorCategory: fallbackError.code || fallbackError.name || "Error",
                    isFallback: true
                })
                // Both providers failed; rethrow the primary error (or fallback if it provides more insight)
                throw fallbackError
            }
        }
    }
}

const aiRouter = new AIRouter()

module.exports = aiRouter
module.exports.AIRouter = AIRouter
