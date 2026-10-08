"use strict"
const crypto = require("crypto")
const { performance } = require("perf_hooks")
const providerRegistry = require("./provider.registry")
const modelRegistry = require("./model.registry")
const modelHealth = require("./model.health")
const routingEngine = require("./routing.engine")
const { isTransientError } = require("./gemini.provider")

/**
 * AIGateway — Health-Aware Multi-Model AI Routing Gateway.
 *
 * Two routing modes:
 *  - AUTO   (requestedModel = null/undefined/"auto"):
 *      RoutingEngine dynamically selects the best healthy model.
 *      Full fallback chain is active.
 *
 *  - MANUAL (requestedModel = "<modelId>"):
 *      Gateway executes ONLY that model.
 *      If the model is unhealthy → MODEL_UNAVAILABLE (no silent fallback).
 *      If the model is unknown    → MODEL_NOT_FOUND.
 *
 * Returns an AIResult: { data, metadata } where metadata contains
 * requestId, model, provider, selectionMode, fallbackCount, totalRequestMs, etc.
 * The data field is the existing AI response — schema unchanged.
 */
class AIGateway {
    constructor(options = {}) {
        this.registry      = options.registry      || providerRegistry
        this.modelRegistry = options.modelRegistry || modelRegistry
        this.modelHealth   = options.modelHealth   || modelHealth
        this.routingEngine = options.routingEngine || routingEngine
    }

    // ─── Provider/Model delegation ──────────────────────────────────────────
    registerProvider(name, provider)  { return this.registry.registerProvider(name, provider) }
    getProvider(name)                 { return this.registry.getProvider(name) }
    hasProvider(name)                 { return this.registry.hasProvider(name) }
    registerModel(modelConfig)        { return this.modelRegistry.registerModel(modelConfig) }
    getModel(id)                      { return this.modelRegistry.getModel(id) }
    getModelHealth(id)                { return this.modelHealth.getHealth(id) }

    isFallbackEnabled() {
        return process.env.AI_ENABLE_FALLBACK !== "false"
    }

    /**
     * Determines whether an error qualifies for automatic model fallback (AUTO mode only).
     */
    isEligibleForFallback(error) {
        if (!error) return false
        if (!this.isFallbackEnabled()) return false
        if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") return false

        const message = (error.message || "").toLowerCase()
        const status  = error.status || error.statusCode || (error.response && error.response.status)

        if (status === 404 || message.includes("404") || message.includes("not_found") || message.includes("no longer available")) {
            return true
        }
        return isTransientError(error)
    }

    // ─── Logging Banners ────────────────────────────────────────────────────
    _logSelection({ requestId, task, providerName, model, priority, isFallback }) {
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

    _logFallback({ requestId, failedModel, failedProvider, errorCode, nextModel, nextProvider, reason }) {
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

    _logSuccess({ requestId, providerName, model, task }) {
        console.log("========================================")
        console.log("AI RESPONSE GENERATED")
        console.log(`Provider: ${providerName.toUpperCase()}`)
        console.log(`Model: ${model}`)
        console.log(`Task: ${task}`)
        console.log("========================================")
    }

    _logPerf(perf) {
        console.log("[AI Performance]")
        console.log(`requestId=${perf.requestId}`)
        console.log(`model=${perf.model}`)
        console.log(`provider=${perf.provider}`)
        if (perf.routingDecisionMs != null) console.log(`routingDecisionMs=${perf.routingDecisionMs}`)
        if (perf.providerRequestMs != null) console.log(`providerRequestMs=${perf.providerRequestMs}`)
        if (perf.fallbackCount != null)      console.log(`fallbackCount=${perf.fallbackCount}`)
        if (perf.totalRequestMs != null)     console.log(`totalRequestMs=${perf.totalRequestMs}`)
        if (perf.result)                     console.log(`result=${perf.result}`)
        if (perf.errorCategory)              console.log(`errorCategory=${perf.errorCategory}`)
    }

    // ─── Model Selection (AUTO mode) ────────────────────────────────────────
    _selectNextModel(attemptedModels, requestId) {
        const routingStart = performance.now()
        const primaryModels = this.modelRegistry.getPrimaryModels()
        const { model: selected, scored } = this.routingEngine.selectBestModel(
            primaryModels, attemptedModels, this.modelHealth
        )
        const routingDecisionMs = Math.round(performance.now() - routingStart)

        if (selected) {
            if (scored.length > 0) {
                const scoreLines = scored
                    .map(s => `${s.modelId}:${s.score.toFixed(3)}(cs=${s.components.coldStart})`)
                    .join(" ")
                console.log(`[AI Router] requestId=${requestId} routingScore=[${scoreLines}] selected=${selected.id}`)
            }
            return { modelConfig: selected, routingDecisionMs }
        }

        const finalFallback = this.modelRegistry.getFinalFallbackModel()
        if (finalFallback && finalFallback.enabled && !attemptedModels.has(finalFallback.id)) {
            console.log(`[AI Router] requestId=${requestId} allPrimaryExhausted=true switching to finalFallback=${finalFallback.id}`)
            return { modelConfig: finalFallback, routingDecisionMs }
        }

        return { modelConfig: null, routingDecisionMs }
    }

    // ─── Model Resolution (MANUAL mode) ─────────────────────────────────────
    /**
     * Resolves a requestedModel string to a registered, verified, eligible model config.
     * Throws MODEL_NOT_FOUND or MODEL_UNAVAILABLE if not eligible.
     *
     * Matching: try exact id match, then model-string match against registry entries.
     */
    _resolveManualModel(requestedModel) {
        if (!requestedModel || requestedModel === "auto") return null

        const allModels = this.modelRegistry.getAllModels()

        // Find by registry id (e.g. "gemini-primary") or by model string (e.g. "gemini-3.1-flash-lite")
        const found = allModels.find(
            m => m.id === requestedModel.toLowerCase() ||
                 m.model === requestedModel ||
                 m.model.toLowerCase() === requestedModel.toLowerCase()
        )

        if (!found) {
            const err = new Error(`Model '${requestedModel}' is not registered in the model registry.`)
            err.code = "MODEL_NOT_FOUND"
            err.statusCode = 404
            err.model = requestedModel
            throw err
        }

        // Must be verified — clients cannot bypass the verified registry
        if (!found.verified) {
            const err = new Error(`Model '${requestedModel}' is not a verified model.`)
            err.code = "MODEL_NOT_FOUND"
            err.statusCode = 404
            err.model = requestedModel
            throw err
        }

        // Check health — circuit breaker
        const isHealthy = this.modelHealth.isHealthy(found.id)
        if (!isHealthy) {
            const err = new Error(`The selected model '${requestedModel}' is currently unavailable. Please choose another model or switch to Auto.`)
            err.code = "MODEL_UNAVAILABLE"
            err.statusCode = 503
            err.model = requestedModel
            err.modelDisplayName = found.displayName || found.model
            throw err
        }

        // Check provider availability
        let provider = null
        try {
            provider = this.registry.getProvider(found.provider)
        } catch (_) {}
        if (!provider || !provider.isAvailable()) {
            const err = new Error(`The selected model '${requestedModel}' is currently unavailable. Please choose another model or switch to Auto.`)
            err.code = "MODEL_UNAVAILABLE"
            err.statusCode = 503
            err.model = requestedModel
            err.modelDisplayName = found.displayName || found.model
            throw err
        }

        return found
    }

    // ─── Provider resolution helper ──────────────────────────────────────────
    _resolveProvider(modelConfig) {
        let provider = null
        try {
            provider = this.registry.getProvider(modelConfig.provider)
        } catch (_) {}
        return provider
    }

    // ─── MAIN execute() — AUTO mode ──────────────────────────────────────────
    /**
     * Executes taskName via dynamic routing (AUTO mode).
     * Returns AIResult: { data, metadata }
     *
     * @param {string}   taskName
     * @param {Function} executeFn  - async (provider, modelOptions) => aiData
     * @param {Object}   [options]
     */
    async execute(taskName, executeFn, options = {}) {
        const requestId       = options.requestId || `ai_${crypto.randomBytes(4).toString("hex")}`
        const totalStart      = performance.now()
        const attemptedModels = new Set()
        let   lastError       = null
        let   fallbackCount   = 0
        let   totalRoutingMs  = 0

        while (true) {
            const { modelConfig: selectedModelConfig, routingDecisionMs } = this._selectNextModel(attemptedModels, requestId)
            totalRoutingMs += routingDecisionMs

            if (!selectedModelConfig) {
                const totalRequestMs = Math.round(performance.now() - totalStart)
                console.log(`[AI Router] requestId=${requestId} allModelsExhausted=true totalLatency=${totalRequestMs}ms`)

                const noProviderErr = new Error(
                    lastError
                        ? `All eligible AI models failed. Last error: ${lastError.message}`
                        : "No available or healthy AI model found to service the request."
                )
                noProviderErr.code       = "PROVIDER_UNAVAILABLE"
                noProviderErr.statusCode = 503
                throw noProviderErr
            }

            attemptedModels.add(selectedModelConfig.id)
            const isFallbackAttempt = attemptedModels.size > 1
            if (isFallbackAttempt) fallbackCount++

            const provider = this._resolveProvider(selectedModelConfig)
            if (!provider || !provider.isAvailable()) {
                const unavailErr = new Error(`Provider '${selectedModelConfig.provider}' is not available.`)
                unavailErr.code = "PROVIDER_UNAVAILABLE"
                this.modelHealth.recordFailure(selectedModelConfig.id, unavailErr, 0)
                lastError = unavailErr
                if (!this.isFallbackEnabled()) throw unavailErr
                continue
            }

            const modelCallOpts = {
                ...options,
                model:      selectedModelConfig.model,
                timeoutMs:  selectedModelConfig.timeoutMs,
                maxRetries: 0
            }

            this._logSelection({
                requestId,
                task:         taskName,
                providerName: selectedModelConfig.provider,
                model:        selectedModelConfig.model,
                priority:     selectedModelConfig.priority,
                isFallback:   isFallbackAttempt
            })
            console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} priority=${selectedModelConfig.priority} fallback=${isFallbackAttempt}`)

            const providerStart = performance.now()

            try {
                const data           = await executeFn(provider, modelCallOpts)
                const providerRequestMs = Math.round(performance.now() - providerStart)
                const totalRequestMs    = Math.round(performance.now() - totalStart)

                this.modelHealth.recordSuccess(selectedModelConfig.id, providerRequestMs)

                console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} latency=${providerRequestMs}ms status=success finalProvider=${selectedModelConfig.provider} totalLatency=${totalRequestMs}ms`)
                this._logSuccess({ requestId, providerName: selectedModelConfig.provider, model: selectedModelConfig.model, task: taskName })

                const metadata = {
                    requestId,
                    model:           selectedModelConfig.model,
                    modelId:         selectedModelConfig.id,
                    provider:        selectedModelConfig.provider,
                    selectionMode:   "auto",
                    fallbackCount,
                    routingDecisionMs: totalRoutingMs,
                    providerRequestMs,
                    totalRequestMs
                }

                this._logPerf({
                    requestId,
                    model:             selectedModelConfig.model,
                    provider:          selectedModelConfig.provider,
                    routingDecisionMs: totalRoutingMs,
                    providerRequestMs,
                    fallbackCount,
                    totalRequestMs
                })

                return { data, metadata }

            } catch (error) {
                const providerRequestMs = Math.round(performance.now() - providerStart)
                lastError = error

                const isTimeout = error.code === "REQUEST_TIMEOUT" || error.name === "AbortError" || (error.message || "").toLowerCase().includes("timeout")
                this.modelHealth.recordFailure(selectedModelConfig.id, error, providerRequestMs)

                console.log(`[AI Router] requestId=${requestId} provider=${selectedModelConfig.provider} model=${selectedModelConfig.model} latency=${providerRequestMs}ms status=${isTimeout ? "timeout" : "failure"} error=${error.code || error.message}`)

                this._logPerf({
                    requestId,
                    model:             selectedModelConfig.model,
                    provider:          selectedModelConfig.provider,
                    providerRequestMs,
                    result:            isTimeout ? "TIMEOUT" : "FAILURE",
                    errorCategory:     error.code || error.name || "TRANSIENT_ERROR"
                })

                const canFallback = this.isEligibleForFallback(error)
                if (!canFallback) throw error

                const { modelConfig: nextCandidate } = this._selectNextModel(attemptedModels, requestId)
                this._logFallback({
                    requestId,
                    failedModel:    selectedModelConfig.model,
                    failedProvider: selectedModelConfig.provider,
                    errorCode:      isTimeout ? "REQUEST_TIMEOUT" : (error.code || error.name || "TRANSIENT_ERROR"),
                    nextModel:      nextCandidate?.model,
                    nextProvider:   nextCandidate?.provider,
                    reason:         `${selectedModelConfig.id} failed (${error.message})`
                })
                if (nextCandidate) {
                    console.log(`[AI Router] requestId=${requestId} fallbackCount=${fallbackCount + 1} nextModel=${nextCandidate.model}`)
                }
            }
        }
    }

    // ─── MANUAL execute — MANUAL mode ────────────────────────────────────────
    /**
     * Executes taskName on a specific, user-requested model (MANUAL mode).
     * Does NOT fall back to another model if the requested model fails.
     * Throws MODEL_UNAVAILABLE or MODEL_NOT_FOUND if model is ineligible.
     *
     * @param {string}   taskName
     * @param {Function} executeFn  - async (provider, modelOptions) => aiData
     * @param {string}   requestedModel - model string or registry id
     * @param {Object}   [options]
     */
    async executeManual(taskName, executeFn, requestedModel, options = {}) {
        const requestId   = options.requestId || `ai_${crypto.randomBytes(4).toString("hex")}`
        const totalStart  = performance.now()

        // Validate & resolve model — throws MODEL_UNAVAILABLE / MODEL_NOT_FOUND
        const modelConfig = this._resolveManualModel(requestedModel)

        const provider = this._resolveProvider(modelConfig)
        // Double-check provider (resolved once more in case something changed)
        if (!provider || !provider.isAvailable()) {
            const err = new Error(`The selected model '${requestedModel}' is currently unavailable. Please choose another model or switch to Auto.`)
            err.code       = "MODEL_UNAVAILABLE"
            err.statusCode = 503
            err.model      = requestedModel
            throw err
        }

        const modelCallOpts = {
            ...options,
            model:      modelConfig.model,
            timeoutMs:  modelConfig.timeoutMs,
            maxRetries: 0
        }

        this._logSelection({
            requestId,
            task:         taskName,
            providerName: modelConfig.provider,
            model:        modelConfig.model,
            priority:     modelConfig.priority,
            isFallback:   false
        })
        console.log(`[AI Router] requestId=${requestId} mode=MANUAL provider=${modelConfig.provider} model=${modelConfig.model}`)

        const providerStart = performance.now()

        try {
            const data              = await executeFn(provider, modelCallOpts)
            const providerRequestMs = Math.round(performance.now() - providerStart)
            const totalRequestMs    = Math.round(performance.now() - totalStart)

            this.modelHealth.recordSuccess(modelConfig.id, providerRequestMs)
            this._logSuccess({ requestId, providerName: modelConfig.provider, model: modelConfig.model, task: taskName })

            const metadata = {
                requestId,
                model:           modelConfig.model,
                modelId:         modelConfig.id,
                provider:        modelConfig.provider,
                selectionMode:   "manual",
                fallbackCount:   0,
                routingDecisionMs: 0,
                providerRequestMs,
                totalRequestMs
            }

            this._logPerf({
                requestId,
                model:             modelConfig.model,
                provider:          modelConfig.provider,
                providerRequestMs,
                fallbackCount:     0,
                totalRequestMs
            })

            return { data, metadata }

        } catch (error) {
            const providerRequestMs = Math.round(performance.now() - providerStart)
            this.modelHealth.recordFailure(modelConfig.id, error, providerRequestMs)

            // MANUAL mode — do NOT fall back. Surface the error directly.
            const isTimeout = error.code === "REQUEST_TIMEOUT" || error.name === "AbortError" || (error.message || "").toLowerCase().includes("timeout")
            this._logPerf({
                requestId,
                model:             modelConfig.model,
                provider:          modelConfig.provider,
                providerRequestMs,
                result:            isTimeout ? "TIMEOUT" : "FAILURE",
                errorCategory:     error.code || error.name || "TRANSIENT_ERROR"
            })

            throw error
        }
    }

    /**
     * Backward-compatible route() method.
     */
    async route(taskName, executeFn, options = {}) {
        return this.execute(taskName, executeFn, options)
    }
}

const aiGateway = new AIGateway()

module.exports = aiGateway
module.exports.AIGateway = AIGateway
