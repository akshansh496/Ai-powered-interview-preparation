const aiGateway = require("./ai.gateway")
const providerRegistry = require("./provider.registry")
const routingEngine = require("./routing.engine")

/**
 * AIRouter — Backward-compatible wrapper delegating execution to AIGateway.
 */
class AIRouter {
    constructor(gateway = aiGateway) {
        this.gateway = gateway
        this.registry = gateway.registry || providerRegistry
        this.routingEngine = gateway.routingEngine || routingEngine
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
     * Routes and executes an AI task through the AI Gateway.
     */
    async route(taskName, executeFn, options = {}) {
        return this.gateway.execute(taskName, executeFn, options)
    }
}

const aiRouter = new AIRouter()

module.exports = aiRouter
module.exports.AIRouter = AIRouter

