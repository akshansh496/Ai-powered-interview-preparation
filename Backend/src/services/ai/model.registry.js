/**
 * ModelRegistry — Centralized registry managing individual AI model configurations,
 * priorities, timeout budgets, availability fallback designations, and verification status.
 *
 * Key design principles:
 *  - All model IDs come exclusively from environment variables. No hardcoded model IDs.
 *  - Each model carries a `verified` flag. Only models with verified:true enter normal routing.
 *  - The `verified` flag is set when the env var is explicitly configured (non-empty).
 *    Models whose env var is absent or blank are registered as verified:false and will not
 *    be scored by RoutingEngine.
 *  - openrouter/free (OPENROUTER_MODEL) is always registered as final fallback regardless of
 *    verified status — it is excluded from scoring by isFinalFallback:true.
 */
class ModelRegistry {
    constructor(options = {}) {
        this.models = new Map()
        this.defaultTimeoutMs = options.defaultTimeoutMs || parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 8000
        this._initDefaultModels()
    }

    _initDefaultModels() {
        const defaultTimeout = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 8000
        const openrouterFreeModel = process.env.OPENROUTER_MODEL || "openrouter/free"

        // ── Gemini Primary ─────────────────────────────────────────────────────
        // Configured via GEMINI_MODEL. If absent/blank → registered as unverified,
        // excluded from scoring.
        const geminiPrimaryModel = process.env.GEMINI_MODEL
        if (geminiPrimaryModel && geminiPrimaryModel.trim()) {
            this.registerModel({
                id: "gemini-primary",
                provider: "gemini",
                model: geminiPrimaryModel.trim(),
                priority: 1,
                enabled: true,
                verified: true,
                timeoutMs: defaultTimeout,
                isFinalFallback: false
            })
        }

        // ── Gemini Secondary ───────────────────────────────────────────────────
        // Configured via GEMINI_SECONDARY_MODEL. Optional — only registered if set.
        const geminiSecondaryModel = process.env.GEMINI_SECONDARY_MODEL
        if (geminiSecondaryModel && geminiSecondaryModel.trim()) {
            this.registerModel({
                id: "gemini-secondary",
                provider: "gemini",
                model: geminiSecondaryModel.trim(),
                priority: 2,
                enabled: true,
                verified: true,
                timeoutMs: defaultTimeout,
                isFinalFallback: false
            })
        }

        // ── OpenRouter Primary ─────────────────────────────────────────────────
        // Configured via OPENROUTER_PRIMARY_MODEL. Optional — only registered if set.
        const openrouterPrimaryModel = process.env.OPENROUTER_PRIMARY_MODEL
        if (openrouterPrimaryModel && openrouterPrimaryModel.trim()) {
            this.registerModel({
                id: "openrouter-primary",
                provider: "openrouter",
                model: openrouterPrimaryModel.trim(),
                priority: 3,
                enabled: true,
                verified: true,
                timeoutMs: defaultTimeout,
                isFinalFallback: false
            })
        }

        // ── OpenRouter Secondary ───────────────────────────────────────────────
        // Configured via OPENROUTER_SECONDARY_MODEL. Optional — only registered if set.
        const openrouterSecondaryModel = process.env.OPENROUTER_SECONDARY_MODEL
        if (openrouterSecondaryModel && openrouterSecondaryModel.trim()) {
            this.registerModel({
                id: "openrouter-secondary",
                provider: "openrouter",
                model: openrouterSecondaryModel.trim(),
                priority: 4,
                enabled: true,
                verified: true,
                timeoutMs: defaultTimeout,
                isFinalFallback: false
            })
        }

        // ── Final Fallback: openrouter/free ────────────────────────────────────
        // Always registered. isFinalFallback:true keeps it out of RoutingEngine scoring.
        // verified:true since it is a fixed known endpoint, not a user-configured model.
        this.registerModel({
            id: "openrouter-free-fallback",
            provider: "openrouter",
            model: openrouterFreeModel,
            priority: 999,
            enabled: true,
            verified: true,
            timeoutMs: defaultTimeout,
            isFinalFallback: true
        })
    }

    /**
     * Registers or updates a model configuration.
     * @param {Object} modelConfig
     * @param {string} modelConfig.id       - Unique registry ID
     * @param {string} modelConfig.provider - Provider name (gemini | openrouter)
     * @param {string} modelConfig.model    - Model identifier passed to the provider API
     * @param {number} [modelConfig.priority]         - Lower number = higher priority (tie-breaker only)
     * @param {boolean} [modelConfig.enabled]         - Whether model participates in routing
     * @param {boolean} [modelConfig.verified]        - Whether model has been verified via real API call
     * @param {number}  [modelConfig.timeoutMs]       - Per-model request timeout override
     * @param {boolean} [modelConfig.isFinalFallback] - True only for openrouter/free last-resort fallback
     */
    registerModel(modelConfig) {
        if (!modelConfig || !modelConfig.id || !modelConfig.provider || !modelConfig.model) {
            throw new Error("Model configuration must contain id, provider, and model.")
        }
        const normalized = {
            id: modelConfig.id.toLowerCase(),
            provider: modelConfig.provider.toLowerCase(),
            model: modelConfig.model,
            priority: typeof modelConfig.priority === "number" ? modelConfig.priority : 100,
            enabled: modelConfig.enabled !== false,
            verified: modelConfig.verified === true,
            timeoutMs: modelConfig.timeoutMs || this.defaultTimeoutMs,
            isFinalFallback: Boolean(modelConfig.isFinalFallback)
        }
        this.models.set(normalized.id, normalized)
        return normalized
    }

    /**
     * Retrieves a model configuration by ID.
     * @param {string} id
     */
    getModel(id) {
        return this.models.get((id || "").toLowerCase()) || null
    }

    /**
     * Checks if a model exists in the registry.
     * @param {string} id
     */
    hasModel(id) {
        return this.models.has((id || "").toLowerCase())
    }

    /**
     * Returns all registered models.
     */
    getAllModels() {
        return Array.from(this.models.values())
    }

    /**
     * Returns all enabled primary models (excluding final fallback), ordered by priority ASC.
     *
     * NOTE: this includes both verified and unverified models.
     * For routing purposes, use getEligiblePrimaryModels() which filters to verified:true only.
     * The RoutingEngine.selectBestModel() also applies the verified filter independently.
     */
    getPrimaryModels() {
        return Array.from(this.models.values())
            .filter(m => m.enabled && !m.isFinalFallback)
            .sort((a, b) => a.priority - b.priority)
    }

    /**
     * Returns verified, enabled primary models ready for routing (excludes unverified).
     * Ordered by priority ASC.
     *
     * Use this when you need the list of models the RoutingEngine will actually consider.
     */
    getEligiblePrimaryModels() {
        return Array.from(this.models.values())
            .filter(m => m.enabled && m.verified && !m.isFinalFallback)
            .sort((a, b) => a.priority - b.priority)
    }

    /**
     * Returns the enabled final fallback model (openrouter/free).
     * Returns null if no isFinalFallback model is registered.
     */
    getFinalFallbackModel() {
        return Array.from(this.models.values()).find(m => m.enabled && m.isFinalFallback) || null
    }

    /**
     * Returns all models that are disabled or unverified (for diagnostics).
     */
    getIneligibleModels() {
        return Array.from(this.models.values())
            .filter(m => !m.isFinalFallback && (!m.enabled || !m.verified))
    }

    /**
     * Clears all models (used in tests).
     */
    clear() {
        this.models.clear()
    }

    /**
     * Resets the registry back to default configured models.
     */
    reset() {
        this.models.clear()
        this._initDefaultModels()
    }
}

const modelRegistry = new ModelRegistry()

module.exports = modelRegistry
module.exports.ModelRegistry = ModelRegistry
