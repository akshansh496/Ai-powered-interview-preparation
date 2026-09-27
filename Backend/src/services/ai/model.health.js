/**
 * ModelHealthTracker — In-memory health tracking and circuit breaker for individual AI models.
 *
 * Tracks:
 *   - consecutiveFailures / totalFailures / totalSuccesses
 *   - lastFailureAt / lastSuccessAt
 *   - temporarilyUnhealthyUntil (circuit breaker cooldown)
 *   - lastLatencyMs
 *   - latencyHistory  — bounded rolling window (max HISTORY_WINDOW entries, successes only)
 *   - recentResults   — bounded rolling window of {success, latencyMs, ts}
 *   - lastError
 *
 * Automatically marks models temporarily unhealthy when failure thresholds are met,
 * enforces cooldown intervals, and coordinates probe recoveries.
 */

const HISTORY_WINDOW = 30 // Keep at most 30 recent observations per model

class ModelHealthTracker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || parseInt(process.env.AI_MODEL_FAILURE_THRESHOLD, 10) || 3
        this.cooldownMs = options.cooldownMs || parseInt(process.env.AI_MODEL_COOLDOWN_MS, 10) || 300000 // 5 mins
        this.historyWindow = options.historyWindow || HISTORY_WINDOW
        this.healthState = new Map()
    }

    /**
     * Retrieves or creates the health state entry for a given model ID.
     * @private
     */
    _getOrCreate(modelId) {
        const key = (modelId || "").toLowerCase()
        if (!this.healthState.has(key)) {
            this.healthState.set(key, {
                modelId: key,
                consecutiveFailures: 0,
                totalFailures: 0,
                totalSuccesses: 0,
                lastFailureAt: null,
                lastSuccessAt: null,
                temporarilyUnhealthyUntil: null,
                lastLatencyMs: null,
                lastError: null,
                // Bounded rolling windows — never exceed historyWindow
                latencyHistory: [],   // number[] — latency in ms per successful request
                recentResults: []     // { success: boolean, latencyMs: number|null, ts: number }[]
            })
        }
        return this.healthState.get(key)
    }

    /**
     * Appends a value to a bounded array, removing the oldest entry when at capacity.
     * @private
     */
    _pushBounded(arr, value) {
        arr.push(value)
        if (arr.length > this.historyWindow) {
            arr.shift()
        }
    }

    /**
     * Checks if a model is currently eligible for request selection.
     * If the cooldown has expired, allows traffic (probe request).
     * @param {string} modelId
     * @returns {boolean}
     */
    isHealthy(modelId) {
        const state = this._getOrCreate(modelId)
        if (!state.temporarilyUnhealthyUntil) {
            return true
        }
        const now = Date.now()
        if (now < state.temporarilyUnhealthyUntil) {
            return false // Model is in active cooldown
        }
        // Cooldown has expired: probe request allowed
        return true
    }

    /**
     * Records a successful execution for a model, resetting failure counts and clearing cooldown.
     * @param {string} modelId
     * @param {number} latencyMs
     */
    recordSuccess(modelId, latencyMs) {
        const state = this._getOrCreate(modelId)
        state.consecutiveFailures = 0
        state.totalSuccesses += 1
        state.lastSuccessAt = new Date().toISOString()
        state.temporarilyUnhealthyUntil = null
        state.lastLatencyMs = typeof latencyMs === "number" ? Math.round(latencyMs) : null
        state.lastError = null

        if (typeof latencyMs === "number") {
            this._pushBounded(state.latencyHistory, Math.round(latencyMs))
        }
        this._pushBounded(state.recentResults, {
            success: true,
            latencyMs: typeof latencyMs === "number" ? Math.round(latencyMs) : null,
            ts: Date.now()
        })
    }

    /**
     * Records a failure for a model, incrementing consecutive failures and triggering cooldown if threshold exceeded.
     * @param {string} modelId
     * @param {Error} error
     * @param {number} latencyMs
     */
    recordFailure(modelId, error, latencyMs) {
        const state = this._getOrCreate(modelId)
        state.consecutiveFailures += 1
        state.totalFailures += 1
        state.lastFailureAt = new Date().toISOString()
        state.lastLatencyMs = typeof latencyMs === "number" ? Math.round(latencyMs) : null
        state.lastError = error ? (error.code || error.name || error.message) : "UNKNOWN_ERROR"

        this._pushBounded(state.recentResults, {
            success: false,
            latencyMs: typeof latencyMs === "number" ? Math.round(latencyMs) : null,
            ts: Date.now()
        })

        if (state.consecutiveFailures >= this.failureThreshold) {
            state.temporarilyUnhealthyUntil = Date.now() + this.cooldownMs
        }
    }

    /**
     * Returns the rolling average latency (ms) across recent successful requests.
     * Returns null if no latency observations exist yet (cold start).
     * @param {string} modelId
     * @returns {number|null}
     */
    getAverageLatencyMs(modelId) {
        const state = this._getOrCreate(modelId)
        if (!state.latencyHistory.length) return null
        const sum = state.latencyHistory.reduce((a, b) => a + b, 0)
        return Math.round(sum / state.latencyHistory.length)
    }

    /**
     * Returns the recent success rate (fraction 0.0–1.0) over the rolling observation window.
     * Returns null if there are no recent observations (cold start — no bias applied).
     * @param {string} modelId
     * @returns {number|null}
     */
    getRecentSuccessRate(modelId) {
        const state = this._getOrCreate(modelId)
        if (!state.recentResults.length) return null
        const successes = state.recentResults.filter(r => r.success).length
        return successes / state.recentResults.length
    }

    /**
     * Returns the number of recent observations in the rolling result window.
     * @param {string} modelId
     * @returns {number}
     */
    getObservationCount(modelId) {
        const state = this._getOrCreate(modelId)
        return state.recentResults.length
    }

    /**
     * Returns a snapshot of a model's health metrics including rolling window stats.
     * @param {string} modelId
     */
    getHealth(modelId) {
        const state = this._getOrCreate(modelId)
        return {
            modelId: state.modelId,
            healthy: this.isHealthy(modelId),
            consecutiveFailures: state.consecutiveFailures,
            totalFailures: state.totalFailures,
            totalSuccesses: state.totalSuccesses,
            lastFailureAt: state.lastFailureAt,
            lastSuccessAt: state.lastSuccessAt,
            temporarilyUnhealthyUntil: state.temporarilyUnhealthyUntil,
            lastLatencyMs: state.lastLatencyMs,
            lastError: state.lastError,
            averageLatencyMs: this.getAverageLatencyMs(modelId),
            recentSuccessRate: this.getRecentSuccessRate(modelId),
            observationCount: state.recentResults.length,
            latencyHistorySize: state.latencyHistory.length
        }
    }

    /**
     * Resets health state for all models (useful for test isolation).
     */
    reset() {
        this.healthState.clear()
    }
}

const modelHealth = new ModelHealthTracker()

module.exports = modelHealth
module.exports.ModelHealthTracker = ModelHealthTracker
module.exports.HISTORY_WINDOW = HISTORY_WINDOW
