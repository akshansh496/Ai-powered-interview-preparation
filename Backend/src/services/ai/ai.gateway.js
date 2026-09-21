const providerRegistry = require("./provider.registry")
const routingEngine = require("./routing.engine")
const { isTransientError } = require("./gemini.provider")

/**
 * AIGateway — Intelligent gateway for dynamic provider evaluation, execution, and resilient fallback.
 * Eliminates hardcoded default providers by evaluating runtime health, reliability, latency, and availability.
 */
class AIGateway {
    constructor(options = {}) {
        this.registry = options.registry || providerRegistry
        this.routingEngine = options.routingEngine || routingEngine
    }

    /**
     * Registers a new or mock provider into the central registry.
     * @param {string} name
     * @param {import("./provider.interface").AIProvider} provider
     */
    registerProvider(name, provider) {
        return this.registry.registerProvider(name, provider)
    }

    /**
     * Retrieves a provider by name from the registry.
     * @param {string} name
     * @returns {import("./provider.interface").AIProvider}
     */
    getProvider(name) {
        return this.registry.getProvider(name)
    }

    /**
     * Checks if a provider exists in the registry.
     * @param {string} name
     * @returns {boolean}
     */
    hasProvider(name) {
        return this.registry.hasProvider(name)
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
        if (!this.isFallbackEnabled()) return false

        // Never fallback on application-level validation or configuration errors
        if (error.code === "CONFIGURATION_ERROR" || error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
            return false
        }
        return isTransientError(error)
    }

    /**
     * Prints formatted console banner when the AI Gateway selects a provider.
     */
    logGatewaySelection({ task, providerName, model, score, candidateNames, reason }) {
        console.log("=================================")
        console.log("AI GATEWAY")
        console.log("=================================")
        console.log(`Task: ${task}`)
        console.log(`Selected Provider: ${providerName}`)
        console.log(`Model: ${model}`)
        console.log(`Score: ${score}`)
        console.log(`Candidate Providers: ${candidateNames.join(", ")}`)
        console.log(`Selection Reason: ${reason}`)
        console.log("=================================")
    }

    /**
     * Prints formatted console banner when provider fallback is initiated.
     */
    logFallback({ failedProvider, errorCode, nextProvider, reason }) {
        console.log("=================================")
        console.log("AI PROVIDER FALLBACK")
        console.log("=================================")
        console.log(`Failed Provider: ${failedProvider}`)
        console.log(`Error: ${errorCode}`)
        console.log(`Next Provider: ${nextProvider}`)
        console.log(`Reason: ${reason}`)
        console.log("=================================")
    }

    /**
     * Prints formatted console banner ONLY after successful generation and schema validation.
     */
    logSuccess(provider, taskName, options = {}) {
        const providerName = (provider?.name || "unknown").toUpperCase()
        const model = options.model || provider?.model || "unknown"

        console.log("========================================")
        console.log("AI RESPONSE GENERATED")
        console.log(`Provider: ${providerName}`)
        console.log(`Model: ${model}`)
        console.log(`Task: ${taskName}`)
        console.log("========================================")
    }

    /**
     * Emits structured JSON log for gateway execution observability.
     */
    logExecution({ task, provider, model, actualModel, score, candidates, reason, success, latencyMs, errorCategory = null, isFallback = false }) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            task,
            provider,
            model,
            ...(actualModel ? { actualModel } : {}),
            score,
            candidates,
            reason,
            success,
            latencyMs,
            ...(isFallback ? { fallback: true } : {}),
            ...(errorCategory ? { errorCategory } : {})
        }
        console.log(`[AIGateway] ${JSON.stringify(logEntry)}`)
    }

    /**
     * Main gateway execution loop: dynamically evaluates available providers,
     * executes the workload with the highest scoring provider, and performs dynamic
     * fallback to the next best candidate on transient infrastructure errors.
     *
     * @param {string} taskName - Name of the task (e.g. 'generateInterviewReport', 'generateResumePdf')
     * @param {Function} executeFn - Async function taking (provider) and returning validated result
     * @param {Object} [options] - Optional execution options
     */
    async execute(taskName, executeFn, options = {}) {
        const excludedProviders = []
        let lastError = null

        while (true) {
            const allProviders = this.registry.getAllProviders()
            const evaluation = this.routingEngine.evaluate(allProviders, {
                excludedProviders,
                task: taskName,
                options
            })

            if (!evaluation.selected) {
                const noProviderErr = new Error(
                    lastError
                        ? `All eligible AI providers failed. Last error: ${lastError.message}`
                        : "No available or healthy AI provider found to service the request."
                )
                noProviderErr.code = "PROVIDER_UNAVAILABLE"
                noProviderErr.statusCode = 503
                throw noProviderErr
            }

            const { provider: selectedProvider, score, reason } = evaluation.selected
            const candidateNames = evaluation.candidates.map(c => c.provider.name)
            const selectedModel = options.model || selectedProvider.model

            // Log AI Gateway selection banner
            this.logGatewaySelection({
                task: taskName,
                providerName: selectedProvider.name,
                model: selectedModel,
                score,
                candidateNames,
                reason
            })

            const callStartTime = Date.now()

            try {
                const result = await executeFn(selectedProvider)
                const latencyMs = Date.now() - callStartTime

                // Record successful outcome in routing engine
                this.routingEngine.recordSuccess(selectedProvider.name, latencyMs)

                // Log success banner & structured telemetry
                this.logSuccess(selectedProvider, taskName, options)
                this.logExecution({
                    task: taskName,
                    provider: selectedProvider.name,
                    model: selectedModel,
                    score,
                    candidates: candidateNames,
                    reason,
                    ...(selectedProvider.lastActualModel ? { actualModel: selectedProvider.lastActualModel } : {}),
                    success: true,
                    latencyMs,
                    isFallback: excludedProviders.length > 0
                })

                return result
            } catch (error) {
                const latencyMs = Date.now() - callStartTime
                lastError = error

                // Record failure in routing engine
                this.routingEngine.recordFailure(selectedProvider.name, error, latencyMs)

                this.logExecution({
                    task: taskName,
                    provider: selectedProvider.name,
                    model: selectedModel,
                    score,
                    candidates: candidateNames,
                    reason,
                    success: false,
                    latencyMs,
                    errorCategory: error.code || error.name || "Error",
                    isFallback: excludedProviders.length > 0
                })

                // Verify if error is eligible for fallback
                const canFallback = this.isEligibleForFallback(error)
                if (!canFallback) {
                    throw error
                }

                // Add failed provider to excluded list for loop protection
                excludedProviders.push(selectedProvider.name)

                // Peek next candidate for fallback logging
                const nextEvaluation = this.routingEngine.evaluate(allProviders, {
                    excludedProviders,
                    task: taskName,
                    options
                })

                if (nextEvaluation.selected) {
                    this.logFallback({
                        failedProvider: selectedProvider.name,
                        errorCode: error.code || error.name || "TRANSIENT_ERROR",
                        nextProvider: nextEvaluation.selected.provider.name,
                        reason: `${selectedProvider.name} transient failure (${error.message})`
                    })
                }
                // Loop continues to attempt next suitable candidate
            }
        }
    }

    /**
     * Backward-compatible route method delegating directly to execute.
     */
    async route(taskName, executeFn, options = {}) {
        return this.execute(taskName, executeFn, options)
    }
}

const aiGateway = new AIGateway()

module.exports = aiGateway
module.exports.AIGateway = AIGateway
