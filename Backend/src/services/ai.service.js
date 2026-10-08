"use strict"
const aiGateway = require("./ai/ai.gateway")
const aiRouter = require("./ai/ai.router")
/**
 * Custom error class representing normalized AI service errors.
 */
class AIError extends Error {
    constructor(message, { code = "AI_GENERIC_ERROR", statusCode = 500, isTransient = false, details = null, model = null } = {}) {
        super(message)
        this.name = "AIError"
        this.code = code
        this.statusCode = statusCode
        this.isTransient = isTransient
        this.details = details
        this.model = model  // Set for MODEL_UNAVAILABLE / MODEL_NOT_FOUND
    }
}

/**
 * Normalizes vendor/network errors into safe, domain-level AIError instances.
 * Guarantees that internal keys, paths, and raw SDK stack traces are not leaked.
 */
function normalizeAIError(error) {
    if (error instanceof AIError) return error

    const message = (error && error.message) || ""
    const lower = message.toLowerCase()
    const code = error && error.code
    const status = error && (error.status || error.statusCode || (error.response && error.response.status))

    // 0. MODEL_UNAVAILABLE / MODEL_NOT_FOUND — already clean, surface directly
    if (code === "MODEL_UNAVAILABLE") {
        return new AIError(error.message || "The selected model is currently unavailable.", {
            code: "MODEL_UNAVAILABLE",
            statusCode: 503,
            isTransient: true,
            model: error.model || null
        })
    }
    if (code === "MODEL_NOT_FOUND") {
        return new AIError(error.message || "The requested model is not available.", {
            code: "MODEL_NOT_FOUND",
            statusCode: 404,
            isTransient: false,
            model: error.model || null
        })
    }

    // 1. Configuration errors
    if (code === "CONFIGURATION_ERROR" || lower.includes("api_key") || lower.includes("api key") || lower.includes("openrouter_api_key") || lower.includes("google_genai_api_key")) {
        return new AIError("AI service configuration error. Please contact the administrator.", {
            code: "CONFIGURATION_ERROR", statusCode: 500, isTransient: false
        })
    }

    // 2. Rate limit / Quota exhaustion
    if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
        return new AIError("AI provider rate limit reached. Please wait a moment before trying again.", {
            code: "RATE_LIMIT_EXCEEDED", statusCode: 429, isTransient: true
        })
    }

    // 3. Timeout errors
    if (code === "REQUEST_TIMEOUT" || lower.includes("timeout") || lower.includes("timed out") || status === 504) {
        return new AIError("AI request timed out. Please try again with shorter input.", {
            code: "REQUEST_TIMEOUT", statusCode: 504, isTransient: true
        })
    }

    // 4. Provider server / service unavailable
    if (status === 503 || status === 502 || status === 500 || lower.includes("overloaded") || lower.includes("service unavailable")) {
        return new AIError("AI service is temporarily unavailable. Please try again shortly.", {
            code: "PROVIDER_UNAVAILABLE", statusCode: 503, isTransient: true
        })
    }

    // 5. Schema / response validation errors
    if (code === "VALIDATION_ERROR" || code === "INVALID_RESPONSE" || lower.includes("schema") || lower.includes("json")) {
        return new AIError("AI response did not meet required format standards. Please refine your inputs and try again.", {
            code: "VALIDATION_ERROR", statusCode: 422, isTransient: false, details: error.details || null
        })
    }

    // 6. Network connectivity errors
    if (lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("fetch failed")) {
        return new AIError("Network connection to AI provider failed. Please check internet access and try again.", {
            code: "NETWORK_ERROR", statusCode: 503, isTransient: true
        })
    }

    // 7. Generic fallback
    return new AIError("Failed to generate AI response. Please try again.", {
        code: "AI_GENERIC_ERROR", statusCode: 500, isTransient: false
    })
}

/**
 * Application boundary for interview report generation via AI Gateway.
 *
 * @param {Object} input
 * @param {string|null} [input.requestedModel] - null/undefined/"auto" for dynamic routing; model id for manual
 * @returns {{ interviewReport, metadata }}  — interviewReport is the existing AI response, metadata is new
 */
async function generateInterviewReport({ resume, selfDescription, jobDescription, daysUntilInterview, requestedModel }, options = {}) {
    try {
        const executeFn = (provider, modelOpts) => provider.generateInterviewReport(
            { resume, selfDescription, jobDescription, daysUntilInterview },
            modelOpts || options
        )

        let aiResult

        if (requestedModel && requestedModel !== "auto") {
            // MANUAL mode
            aiResult = await aiGateway.executeManual("generateInterviewReport", executeFn, requestedModel, options)
        } else {
            // AUTO mode
            aiResult = await aiGateway.execute("generateInterviewReport", executeFn, options)
        }

        // aiResult = { data, metadata }
        return {
            interviewReport: aiResult.data,
            metadata: aiResult.metadata
        }
    } catch (error) {
        console.error("AI Service - generateInterviewReport failed:", error.message)
        throw normalizeAIError(error)
    }
}

/**
 * Application boundary for resume HTML generation via AI Gateway.
 *
 * @param {Object} input
 * @param {string|null} [input.requestedModel]
 * @returns {{ html, metadata }}
 */
async function generateResumePdf({ resume, selfDescription, jobDescription, requestedModel }, options = {}) {
    try {
        const executeFn = (provider, modelOpts) => provider.generateResumePdf(
            { resume, selfDescription, jobDescription },
            modelOpts || options
        )

        let aiResult

        if (requestedModel && requestedModel !== "auto") {
            aiResult = await aiGateway.executeManual("generateResumePdf", executeFn, requestedModel, options)
        } else {
            aiResult = await aiGateway.execute("generateResumePdf", executeFn, options)
        }

        return {
            html: aiResult.data,
            metadata: aiResult.metadata
        }
    } catch (error) {
        console.error("AI Service - generateResumePdf failed:", error.message)
        throw normalizeAIError(error)
    }
}

module.exports = {
    generateInterviewReport,
    generateResumePdf,
    normalizeAIError,
    AIError,
    aiGateway,
    aiRouter
}