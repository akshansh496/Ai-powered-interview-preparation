/**
 * RoutingEngine — Runtime evaluation and dynamic suitability scoring for AI providers.
 * Evaluates provider availability, rate limits, health, reliability, and latency.
 */
class RoutingEngine {
    constructor(options = {}) {
        this.rateLimitCooldownMs = options.rateLimitCooldownMs || 60000 // 60s cooldown on 429
        this.maxLatencySamples = options.maxLatencySamples || 20
        this.providerState = new Map()
    }

    /**
     * Retrieves or initializes runtime state for a provider.
     * @private
     */
    _getOrCreateState(providerName) {
        const key = (providerName || "").toLowerCase()
        if (!this.providerState.has(key)) {
            this.providerState.set(key, {
                successCount: 0,
                failureCount: 0,
                consecutiveFailures: 0,
                recentLatencies: [],
                lastSuccess: null,
                lastFailure: null,
                rateLimitedUntil: null,
                lastError: null
            })
        }
        return this.providerState.get(key)
    }

    /**
     * Records a successful execution.
     * @param {string} providerName
     * @param {number} latencyMs
     */
    recordSuccess(providerName, latencyMs) {
        const state = this._getOrCreateState(providerName)
        state.successCount += 1
        state.consecutiveFailures = 0
        state.lastSuccess = Date.now()
        state.rateLimitedUntil = null

        if (typeof latencyMs === "number" && latencyMs >= 0) {
            state.recentLatencies.push(latencyMs)
            if (state.recentLatencies.length > this.maxLatencySamples) {
                state.recentLatencies.shift()
            }
        }
    }

    /**
     * Records a failed execution and marks rate limits if applicable.
     * @param {string} providerName
     * @param {Error} error
     * @param {number} latencyMs
     */
    recordFailure(providerName, error, latencyMs) {
        const state = this._getOrCreateState(providerName)
        state.failureCount += 1
        state.consecutiveFailures += 1
        state.lastFailure = Date.now()
        state.lastError = error ? (error.code || error.name || error.message) : "UNKNOWN_ERROR"

        const status = error && (error.status || error.statusCode || (error.response && error.response.status))
        const message = ((error && error.message) || "").toLowerCase()

        if (status === 429 || message.includes("429") || message.includes("rate limit") || message.includes("quota")) {
            state.rateLimitedUntil = Date.now() + this.rateLimitCooldownMs
        }

        if (typeof latencyMs === "number" && latencyMs >= 0) {
            state.recentLatencies.push(latencyMs)
            if (state.recentLatencies.length > this.maxLatencySamples) {
                state.recentLatencies.shift()
            }
        }
    }

    /**
     * Checks whether a provider is currently rate-limited.
     * @param {string} providerName
     * @returns {boolean}
     */
    isRateLimited(providerName) {
        const state = this._getOrCreateState(providerName)
        if (!state.rateLimitedUntil) return false
        if (Date.now() < state.rateLimitedUntil) {
            return true
        }
        // Cooldown has expired
        state.rateLimitedUntil = null
        return false
    }

    /**
     * Returns a snapshot of a provider's runtime health metrics.
     * @param {string} providerName
     * @returns {Object}
     */
    getProviderState(providerName) {
        const state = this._getOrCreateState(providerName)
        const total = state.successCount + state.failureCount
        const successRate = total === 0 ? 1.0 : state.successCount / total
        const avgLatency = state.recentLatencies.length === 0
            ? 800
            : Math.round(state.recentLatencies.reduce((a, b) => a + b, 0) / state.recentLatencies.length)

        return {
            provider: (providerName || "").toLowerCase(),
            rateLimited: this.isRateLimited(providerName),
            successCount: state.successCount,
            failureCount: state.failureCount,
            consecutiveFailures: state.consecutiveFailures,
            successRate,
            averageLatencyMs: avgLatency,
            lastSuccess: state.lastSuccess,
            lastFailure: state.lastFailure,
            rateLimitedUntil: state.rateLimitedUntil
        }
    }

    /**
     * Calculates a deterministic suitability score (0 - 100) for a provider.
     *
     * Scoring Weights:
     * - Capability: 25 pts (structured JSON output conformance)
     * - Availability: 20 pts (API key configured and valid)
     * - Health & Reliability: 35 pts (rolling success rate + consecutive failure penalty)
     * - Latency: 20 pts (rolling average response time)
     *
     * @param {import("./provider.interface").AIProvider} provider
     * @param {string} task
     * @param {Object} [options]
     * @returns {{ score: number, reason: string, state: Object, eligible: boolean }}
     */
    calculateScore(provider, task = "generateInterviewReport", options = {}) {
        const providerName = provider?.name || "unknown"
        const isAvailable = typeof provider?.isAvailable === "function" ? provider.isAvailable() : false
        const isRateLimited = this.isRateLimited(providerName)

        if (!isAvailable) {
            return {
                score: -1,
                reason: "unavailable (API key not configured)",
                state: this.getProviderState(providerName),
                eligible: false
            }
        }

        if (isRateLimited) {
            return {
                score: -1,
                reason: "rate limited (in active cooldown)",
                state: this.getProviderState(providerName),
                eligible: false
            }
        }

        const state = this.getProviderState(providerName)

        // 1. Capability Score (25 pts max)
        const capabilityScore = 25

        // 2. Availability Score (20 pts max)
        const availabilityScore = 20

        // 3. Health & Reliability Score (35 pts max)
        const reliabilityScore = Math.round(state.successRate * 30)
        const failurePenalty = Math.max(0, 5 - (state.consecutiveFailures * 2))
        const healthScore = reliabilityScore + failurePenalty

        // 4. Latency Score (20 pts max)
        // Normalized: avgLatency <= 400ms -> 20pts; 1000ms -> 15pts; 2000ms -> 10pts; 3000ms+ -> 5pts
        const latencyScore = Math.max(2, Math.min(20, Math.round(20 - (state.averageLatencyMs / 200))))

        const totalScore = capabilityScore + availabilityScore + healthScore + latencyScore

        const reasons = []
        if (state.consecutiveFailures === 0) reasons.push("healthy")
        else reasons.push(`${state.consecutiveFailures} recent failure(s)`)

        reasons.push(`success rate ${(state.successRate * 100).toFixed(0)}%`)
        reasons.push(`avg latency ${state.averageLatencyMs}ms`)
        reasons.push("structured JSON support")

        return {
            score: totalScore,
            reason: reasons.join(" + "),
            state,
            eligible: true
        }
    }

    /**
     * Evaluates a collection of providers and ranks eligible candidates by suitability score.
     *
     * @param {import("./provider.interface").AIProvider[]} providers
     * @param {Object} [evalOptions]
     * @param {string[]} [evalOptions.excludedProviders] - Provider names to exclude (loop protection)
     * @param {string} [evalOptions.task] - Task name
     * @param {Object} [evalOptions.options] - Optional execution overrides
     * @returns {{ selected: Object|null, candidates: Object[], evaluatedCount: number }}
     */
    evaluate(providers = [], evalOptions = {}) {
        const { excludedProviders = [], task = "generateInterviewReport", options = {} } = evalOptions
        const excludedSet = new Set(excludedProviders.map(p => (p || "").toLowerCase()))

        const candidates = []

        for (const provider of providers) {
            if (!provider || !provider.name) continue
            const nameLower = provider.name.toLowerCase()

            if (excludedSet.has(nameLower)) {
                continue
            }

            const scoring = this.calculateScore(provider, task, options)
            if (scoring.eligible && scoring.score > 0) {
                candidates.push({
                    provider,
                    score: scoring.score,
                    reason: scoring.reason,
                    state: scoring.state
                })
            }
        }

        // Sort candidates descending by score, then higher successRate, then lower latency
        candidates.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score
            }
            if (b.state.successRate !== a.state.successRate) {
                return b.state.successRate - a.state.successRate
            }
            if (a.state.averageLatencyMs !== b.state.averageLatencyMs) {
                return a.state.averageLatencyMs - b.state.averageLatencyMs
            }
            return a.provider.name.localeCompare(b.provider.name)
        })

        // In test mode, allow options.forceProvider to test specific provider selection
        if (process.env.NODE_ENV === "test" && options.forceProvider) {
            const forced = candidates.find(c => c.provider.name.toLowerCase() === options.forceProvider.toLowerCase())
            if (forced) {
                return {
                    selected: forced,
                    candidates,
                    evaluatedCount: providers.length
                }
            }
        }

        return {
            selected: candidates[0] || null,
            candidates,
            evaluatedCount: providers.length
        }
    }

    /**
     * Resets runtime state for all providers (useful for test isolation).
     */
    resetState() {
        this.providerState.clear()
    }
}

const routingEngine = new RoutingEngine()

module.exports = routingEngine
module.exports.RoutingEngine = RoutingEngine
