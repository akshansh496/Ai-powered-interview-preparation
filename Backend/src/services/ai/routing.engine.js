/**
 * RoutingEngine — Dynamic, request-time model scoring and selection.
 *
 * Scoring formula (all weights sum to 1.0):
 *
 *   score = (0.45 × successScore) + (0.30 × latencyScore) + (0.20 × healthScore) + (0.05 × availabilityScore)
 *
 * Component definitions
 * ─────────────────────
 * successScore   : recent success rate over rolling window (null → COLD_START_SUCCESS_RATE default)
 * latencyScore   : normalized inverse latency; faster = higher score
 *                  latency ≤ LATENCY_BEST_MS  → 1.0
 *                  latency ≥ LATENCY_WORST_MS → 0.0
 *                  null (cold start)          → COLD_START_LATENCY_SCORE default
 * healthScore    : 1.0 if model isHealthy(), 0.0 if in active circuit-breaker cooldown
 * availabilityScore : 1.0 (model is in registry and enabled, otherwise it wouldn't be a candidate)
 *
 * Cold-start policy
 * ─────────────────
 * When a model has fewer than MIN_OBSERVATIONS observations, cold-start defaults are used
 * instead of measured values. This avoids penalizing fresh models for lack of history.
 *
 * Final fallback exclusion
 * ────────────────────────
 * Models flagged isFinalFallback:true are NEVER scored or ranked by this engine.
 * They must be handled separately by AIGateway as the last-resort option.
 */

// ────────────────────────────────────────────────
// Tunable constants (all exported for testability)
// ────────────────────────────────────────────────

/** Weight for recent success rate contribution to overall score. */
const WEIGHT_SUCCESS = 0.45
/** Weight for latency contribution to overall score. */
const WEIGHT_LATENCY = 0.30
/** Weight for circuit-breaker health status contribution. */
const WEIGHT_HEALTH = 0.20
/** Weight for registry availability (always 1.0 for candidates). */
const WEIGHT_AVAILABILITY = 0.05

/** Latency at or below this value scores 1.0 (best). */
const LATENCY_BEST_MS = 1000
/** Latency at or above this value scores 0.0 (worst). */
const LATENCY_WORST_MS = 7000

/** Default success score applied to cold-start models with no observations. */
const COLD_START_SUCCESS_RATE = 0.90
/** Default latency score applied to cold-start models with no latency history. */
const COLD_START_LATENCY_SCORE = 0.70
/** Minimum observations before measured values replace cold-start defaults. */
const MIN_OBSERVATIONS = 3

class RoutingEngine {
    /**
     * @param {Object} [options]
     * @param {Object} [options.weights] - Override individual scoring weights (must sum to 1.0)
     * @param {number} [options.latencyBestMs]  - Latency threshold for perfect latency score
     * @param {number} [options.latencyWorstMs] - Latency threshold for zero latency score
     * @param {number} [options.coldStartSuccessRate] - Default success rate for cold-start models
     * @param {number} [options.coldStartLatencyScore] - Default latency score for cold-start models
     * @param {number} [options.minObservations] - Observations required before using measured values
     */
    constructor(options = {}) {
        const w = options.weights || {}
        this.weights = {
            success: w.success !== undefined ? w.success : WEIGHT_SUCCESS,
            latency: w.latency !== undefined ? w.latency : WEIGHT_LATENCY,
            health: w.health !== undefined ? w.health : WEIGHT_HEALTH,
            availability: w.availability !== undefined ? w.availability : WEIGHT_AVAILABILITY
        }
        this.latencyBestMs = options.latencyBestMs !== undefined ? options.latencyBestMs : LATENCY_BEST_MS
        this.latencyWorstMs = options.latencyWorstMs !== undefined ? options.latencyWorstMs : LATENCY_WORST_MS
        this.coldStartSuccessRate = options.coldStartSuccessRate !== undefined ? options.coldStartSuccessRate : COLD_START_SUCCESS_RATE
        this.coldStartLatencyScore = options.coldStartLatencyScore !== undefined ? options.coldStartLatencyScore : COLD_START_LATENCY_SCORE
        this.minObservations = options.minObservations !== undefined ? options.minObservations : MIN_OBSERVATIONS
    }

    /**
     * Normalizes raw latency (ms) to a [0.0, 1.0] score where lower latency = higher score.
     * Applies linear interpolation between latencyBestMs (1.0) and latencyWorstMs (0.0).
     *
     * @param {number|null} latencyMs - Average observed latency in milliseconds, or null
     * @returns {number} Normalized score in range [0.0, 1.0]
     */
    normalizeLatency(latencyMs) {
        if (latencyMs === null || latencyMs === undefined || isNaN(latencyMs)) {
            return this.coldStartLatencyScore
        }
        if (latencyMs <= this.latencyBestMs) return 1.0
        if (latencyMs >= this.latencyWorstMs) return 0.0
        const range = this.latencyWorstMs - this.latencyBestMs
        return (this.latencyWorstMs - latencyMs) / range
    }

    /**
     * Computes the composite routing score for a single model.
     *
     * @param {Object} modelConfig - Entry from ModelRegistry (id, priority, enabled, isFinalFallback, …)
     * @param {Object} healthTracker - ModelHealthTracker instance
     * @returns {{ modelId: string, score: number, components: Object }} Score breakdown
     */
    scoreModel(modelConfig, healthTracker) {
        const id = modelConfig.id

        const observationCount = healthTracker.getObservationCount(id)
        const hasSufficientHistory = observationCount >= this.minObservations

        // ── Success component ──────────────────────────────────────────────────
        const rawSuccessRate = healthTracker.getRecentSuccessRate(id)
        const successScore = hasSufficientHistory && rawSuccessRate !== null
            ? rawSuccessRate
            : this.coldStartSuccessRate

        // ── Latency component ──────────────────────────────────────────────────
        const avgLatencyMs = healthTracker.getAverageLatencyMs(id)
        const latencyScore = hasSufficientHistory && avgLatencyMs !== null
            ? this.normalizeLatency(avgLatencyMs)
            : this.coldStartLatencyScore

        // ── Health component ───────────────────────────────────────────────────
        const healthScore = healthTracker.isHealthy(id) ? 1.0 : 0.0

        // ── Availability component ─────────────────────────────────────────────
        // Candidates reaching this point are always enabled & registered → 1.0
        const availabilityScore = 1.0

        // ── Composite weighted score ───────────────────────────────────────────
        const score =
            (this.weights.success * successScore) +
            (this.weights.latency * latencyScore) +
            (this.weights.health * healthScore) +
            (this.weights.availability * availabilityScore)

        return {
            modelId: id,
            score: Math.min(1.0, Math.max(0.0, score)),
            components: {
                successScore,
                latencyScore,
                healthScore,
                availabilityScore,
                observationCount,
                avgLatencyMs: avgLatencyMs !== null ? avgLatencyMs : null,
                rawSuccessRate: rawSuccessRate !== null ? rawSuccessRate : null,
                coldStart: !hasSufficientHistory
            }
        }
    }

    /**
     * Selects the best eligible primary model at request time.
     *
     * Rules:
     *  1. Only enabled, verified, non-finalFallback models that have not yet been
     *     attempted and pass health.isHealthy() are eligible candidates.
     *     — verified:false models are NEVER scored (they have not been confirmed working).
     *  2. Each candidate is scored using scoreModel().
     *  3. The candidate with the highest composite score wins.
     *  4. Ties are broken deterministically by priority (lower number = higher priority).
     *
     * @param {Object[]} primaryModels      - All primary (non-finalFallback) model configs
     * @param {Set<string>} attemptedModels - Model IDs already attempted in this request
     * @param {Object} healthTracker        - ModelHealthTracker instance
     * @returns {{ model: Object|null, scored: Array }} Selected model config and full score breakdown
     */
    selectBestModel(primaryModels, attemptedModels, healthTracker) {
        // Filter to eligible candidates only.
        // A model must be: enabled AND verified AND not the final fallback
        //                  AND not already attempted AND currently healthy.
        const eligible = primaryModels.filter(m =>
            m.enabled &&
            m.verified !== false &&          // explicit false OR missing → excluded
            !m.isFinalFallback &&
            !attemptedModels.has(m.id) &&
            healthTracker.isHealthy(m.id)
        )

        if (!eligible.length) {
            return { model: null, scored: [] }
        }

        // Score all candidates
        const scored = eligible.map(m => ({
            ...this.scoreModel(m, healthTracker),
            modelConfig: m
        }))

        // Sort: highest score first; ties broken by priority (ascending = higher priority)
        scored.sort((a, b) => {
            if (Math.abs(a.score - b.score) < 1e-9) {
                return a.modelConfig.priority - b.modelConfig.priority
            }
            return b.score - a.score
        })

        return { model: scored[0].modelConfig, scored }
    }
}

const routingEngine = new RoutingEngine()

module.exports = routingEngine
module.exports.RoutingEngine = RoutingEngine
module.exports.WEIGHT_SUCCESS = WEIGHT_SUCCESS
module.exports.WEIGHT_LATENCY = WEIGHT_LATENCY
module.exports.WEIGHT_HEALTH = WEIGHT_HEALTH
module.exports.WEIGHT_AVAILABILITY = WEIGHT_AVAILABILITY
module.exports.LATENCY_BEST_MS = LATENCY_BEST_MS
module.exports.LATENCY_WORST_MS = LATENCY_WORST_MS
module.exports.COLD_START_SUCCESS_RATE = COLD_START_SUCCESS_RATE
module.exports.COLD_START_LATENCY_SCORE = COLD_START_LATENCY_SCORE
module.exports.MIN_OBSERVATIONS = MIN_OBSERVATIONS
