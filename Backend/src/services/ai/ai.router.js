const aiGateway = require("./ai.gateway")
const providerRegistry = require("./provider.registry")
const modelRegistry = require("./model.registry")
const modelHealth = require("./model.health")

/**
 * AIRouter — Central model-aware AI Router delegating to AIGateway.
 * Exposes provider and model registration, health status, and task routing.
 */
class AIRouter {
    constructor(gateway = aiGateway) {
        this.gateway = gateway
        this.registry = gateway.registry || providerRegistry
        this.modelRegistry = gateway.modelRegistry || modelRegistry
        this.modelHealth = gateway.modelHealth || modelHealth
    }

    /**
     * Registers a new or mock provider into the central registry.
     */
    registerProvider(name, provider) {
        return this.gateway.registerProvider(name, provider)
    }

    /**
     * Retrieves a provider by name from the registry.
     */
    getProvider(name) {
        return this.gateway.getProvider(name)
    }

    /**
     * Checks if a provider exists in the registry.
     */
    hasProvider(name) {
        return this.gateway.hasProvider(name)
    }

    /**
     * Registers a model configuration into the model registry.
     */
    registerModel(modelConfig) {
        return this.gateway.registerModel(modelConfig)
    }

    /**
     * Retrieves a model configuration by ID.
     */
    getModel(id) {
        return this.gateway.getModel(id)
    }

    /**
     * Returns health metrics for a model ID.
     */
    getModelHealth(id) {
        return this.gateway.getModelHealth(id)
    }

    /**
     * Routes and executes an AI task through the AI Gateway.
     */
    async route(taskName, executeFn, options = {}) {
        return this.gateway.execute(taskName, executeFn, options)
    }
}

const aiRouter = new AIRouter()

module.exports = aiRouter
module.exports.AIRouter = AIRouter
