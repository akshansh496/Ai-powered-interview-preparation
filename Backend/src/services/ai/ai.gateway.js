const crypto = require("crypto")
const providerRegistry = require("./provider.registry")
const modelRegistry = require("./model.registry")
const modelHealth = require("./model.health")
const routingEngine = require("./routing.engine")
const { isTransientError } = require("./gemini.provider")

/**
 * AIGateway — Health-Aware Multi-Model AI Routing Gateway with Strict Timeouts & Fallback.
 * Maintains individual model priorities, circuit-breaker health tracking, request abortion,
 * and loop-protected sequential fallback terminating at openrouter/free before controlled error.
 */
class AIGateway {
    constructor(options = {}) {
        this.registry = options.registry || providerRegistry
        this.modelRegistry = options.modelRegistry || modelRegistry
        this.modelHealth = options.modelHealth || modelHealth
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
     * Registers a model configuration into the model registry.
     */
    registerModel(modelConfig) {
        return this.modelRegistry.registerModel(modelConfig)
    }

    /**
     * Retrieves a model configuration by ID.
     */
    getModel(id) {
        return this.modelRegistry.getModel(id)
    }

    /**
     * Returns health metrics for a model ID.
     */
    getModelHealth(id) {
        return this.modelHealth.getHealth(id)
    }

    /**
     * Checks whether automatic fallback is enabled.
     * @returns {boolean}
     */
    isFallbackEnabled() {
        return process.env.AI_ENABLE_FALLBACK !== "false"
    }

    /**
     * Determines whether an error qualifies for automatic model fallback.
     * Only transient provider infrastructure failures, model unavailabilities, & timeouts qualify.
     */
    isEligibleForFallback(error) {
        if (!error) return false
        if (!this.isFallbackEnabled()) return false

        // Never fallback on application-level validation or bad input
        if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
            return false
        }

        const message = (error.message || "").toLowerCase()
        const status = error.status || error.statusCode || (error.response && error.response.status)

        // 404 on model API endpoint indicates model ID deprecation or unavailability on provider
        if (status === 404 || message.includes("404") || message.includes("not_found") || message.includes("no longer available")) {
            return true
        }

        return isTransientError(error)
    }

    /**
     * Prints formatted console banner when the AI Gateway selects a model.
     */
    logGatewaySelection({ requestId, task, providerName, model, priority, isFallback }) {
        console.log("=================================")
        console.log("AI GATEWAY - MODEL ROUTER")
        console.log("=================================")
        console.log(`Request ID: ${requestId}`)
        console.log(`Task: ${task}`)
        console.log(`Provider: ${providerName}`)
        console.log(`Model: ${model}`)
        console.log(`Priority: ${priority}`)
        console.log(`Fallback Attempt: ${isFallback}`)
        console.log("=================================")
    }

    /**
     * Prints formatted console banner when model fallback is initiated.
     */
    logFallback({ requestId, failedModel, failedProvider, errorCode, nextModel, nextProvider, reason }) {
        console.log("=================================")
        console.log("AI MODEL FALLBACK INITIATED")
        console.log("=================================")
        console.log(`Request ID: ${requestId}`)
        console.log(`Failed Model: ${failedModel} (${failedProvider})`)
        console.log(`Error: ${errorCode}`)
        console.log(`Next Target: ${nextModel || "None"} (${nextProvider || "None"})`)
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
     * Dynamically selects the next eligible model at request time using RoutingEngine scoring.
     *
     * Primary models are ranked by composite score (success rate, latency, health, availability).
     * The final fallback model is only returned after all primary candidates are exhausted.
     *
     * @param {Set<string>} attemptedModels - Model IDs already attempted in this request cycle
     * @param {string} [requestId] - Optional request ID for trace logging
     * @returns {Object|null} Best eligible model config, or null if all options are exhausted
     * @private
     */
    _selectNextModel(attemptedModels, requestId) {
        const primaryModels = this.modelRegistry.getPrimaryModels()

        // Use RoutingEngine to score and select the best eligible primary model dynamically
        const { model: selected, scored } = this.routingEngine.selectBestModel(
            primaryModels,
            attemptedModels,
            this.modelHealth
        )

        if (selected) {
            // Emit a routing score trace for observability
            if (scored.length > 0) {
                const scoreLines = scored
                    .map(s => `${s.modelId}:${s.score.toFixed(3)}(cs=${s.components.coldStart})`)
                    .join(" ")
                console.log(`[AI Router] requestId=${requestId || "?"} routingScore=[${scoreLines}] selected=${selected.id}`)
            }
            return selected
        }

        // All primary models exhausted or unhealthy — try the final availability fallback
        const finalFallback = this.modelRegistry.getFinalFallbackModel()
        if (finalFallback && finalFallback.enabled && !attemptedModels.has(finalFallback.id)) {
            console.log(`[AI Router] requestId=${requestId || "?"} allPrimaryExhausted=true switching to finalFallback=${finalFallback.id}`)
            return finalFallback
        }

        return null
    }

    /**
     * Main model-aware execution loop:
     * 1. Iterates through healthy registered models by priority.
     * 2. Applies hard timeout budget and request cancellation.
     * 3. Falls back to next healthy model on timeout or transient failure.
     * 4. Uses openrouter/free strictly as the final availability fallback.
     * 5. Returns controlled AIError if all models fail.
     *
     * @param {string} taskName - Name of the task (e.g. 'generateInterviewReport', 'generateResumePdf')
     * @param {Function} executeFn - Async function taking (provider, modelOptions)
     * @param {Object} [options] - Optional execution options
     */
    async execute(taskName, executeFn, options = {}) {
        const requestId = options.requestId || `ai_${crypto.randomBytes(4).toString("hex")}`
        const attemptedModels = new Set()
        const totalStartTime = Date.now()
        let lastError = null

        while (true) {
            const selectedModelConfig = this._selectNextModel(attemptedModels, requestId)

            if (!selectedModelConfig) {
                const totalLatencyMs = Date.now() - totalStartTime
                console.log(`[AI Router] requestId=${requestId} allModelsExhausted=true totalLatency=${totalLatencyMs}ms`)

                const noProviderErr = new Error(
                    lastError
                        ? `All eligible AI models failed. Last error: ${lastError.message}`
                        : "No available or healthy AI model found to service the request."
                )
                noProviderErr.code = "PROVIDER_UNAVAILABLE"
                noProviderErr.statusCode = 503
                throw noProviderErr
            }

            // Loop protection: Mark model attempted immediately
            attemptedModels.add(selectedModelConfig.id)
            const isFallbackAttempt = attemptedModels.size > 1

            // Resolve underlying provider
            let provider = null
            try {
                provider = this.registry.getProvider(selectedModelConfig.provider)
            } catch (err) {
                // Provider missing or unconfigured
                this.modelHealth.recordFailure(selectedModelConfig.id, err, 0)
                lastError = err
                if (!this.isFallbackEnabled()) throw err
                continue
            }

            if (!provider || !provider.isAvailable()) {
                const unavailErr = new Error(`Provider '${selectedModelConfig.provider}' is not available or missing API credentials.`)
                unavailErr.code = "PROVIDER_UNAVAILABLE"
                this.modelHealth.recordFailure(selectedModelConfig.id, unavailErr, 0)
                lastError = unavailErr
                if (!this.isFallbackEnabled()) throw unavailErr
                continue
            }

            // Model execution options
            const modelCallOpts = {
                ...options,
                model: selectedModelConfig.model,
                timeoutMs: selectedModelConfig.timeoutMs,
                maxRetries: 0 // Router handles multi-model fallback, no internal retry loop per model
            }

            this.logGatewaySelection({
                requestId,
                task: taskName,
                providerName: selectedModelConfig.provider,
                model: selectedModelConfig.model,
                priority: selectedModelConfig.priority,
                isFallback: isFallbackAttempt
            })

            console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} priority=${selectedModelConfig.priority} fallback=${isFallbackAttempt}`)

            const modelStartTime = Date.now()

            try {
                // Support both (provider, options) and (provider) signatures
                const result = await executeFn(provider, modelCallOpts)
                const latencyMs = Date.now() - modelStartTime
                const totalLatencyMs = Date.now() - totalStartTime

                // Record success & clear health cooldown
                this.modelHealth.recordSuccess(selectedModelConfig.id, latencyMs)

                // Trace telemetry
                console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} latency=${latencyMs}ms status=success finalProvider=${selectedModelConfig.provider} totalLatency=${totalLatencyMs}ms`)

                this.logSuccess(provider, taskName, modelCallOpts)
                return result
            } catch (error) {
                const latencyMs = Date.now() - modelStartTime
                lastError = error

                const isTimeout = error.code === "REQUEST_TIMEOUT" || error.name === "AbortError" || (error.message || "").toLowerCase().includes("timeout")

                // Record failure & increment circuit-breaker counters
                this.modelHealth.recordFailure(selectedModelConfig.id, error, latencyMs)

                console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} latency=${latencyMs}ms status=${isTimeout ? "timeout" : "failure"} error=${error.code || error.message}`)
                if (isTimeout) {
                    console.log(`[AI Router] requestId=${requestId} timeout=true`)
                }

                // Verify fallback eligibility
                const canFallback = this.isEligibleForFallback(error)
                if (!canFallback) {
                    throw error
                }

                // Fallback logging
                const nextCandidate = this._selectNextModel(attemptedModels, requestId)
                this.logFallback({
                    requestId,
                    failedModel: selectedModelConfig.model,
                    failedProvider: selectedModelConfig.provider,
                    errorCode: isTimeout ? "REQUEST_TIMEOUT" : (error.code || error.name || "TRANSIENT_ERROR"),
                    nextModel: nextCandidate?.model,
                    nextProvider: nextCandidate?.provider,
                    reason: `${selectedModelConfig.id} failed (${error.message})`
                })

                if (nextCandidate) {
                    console.log(`[AI Router] requestId=${requestId} fallback=${nextCandidate.model}`)
                }
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
