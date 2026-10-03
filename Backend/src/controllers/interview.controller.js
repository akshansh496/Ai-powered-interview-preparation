"use strict"
const pdfParse = require("pdf-parse")
const { generateInterviewReport, generateResumePdf, AIError } = require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")

// ─── Model Status Controller ─────────────────────────────────────────────────
const modelRegistry = require("../services/ai/model.registry")
const modelHealth   = require("../services/ai/model.health")

/**
 * @description Returns the list of AI models available for selection.
 *
 * GET /api/ai/models
 *
 * Response shape:
 * {
 *   "models": [
 *     { id, name, provider, available, healthy },
 *     ...
 *     { id: "gateway-auto", name: "Auto — Let Gateway Decide", available: true, healthy: true }
 *   ]
 * }
 *
 * No API keys or internal secrets are exposed.
 */
function getAvailableModelsController(req, res) {
    try {
        // Only eligible primary models (verified, enabled, non-fallback) are surfaced
        const eligibleModels = modelRegistry.getEligiblePrimaryModels()

        const models = eligibleModels.map(m => {
            const health  = modelHealth.getHealth(m.id)
            const healthy = health.healthy

            return {
                id:        m.model,        // model string — what clients send as requestedModel
                registryId: m.id,          // internal registry key (informational only)
                name:      _formatModelName(m.model, m.provider),
                provider:  _formatProviderName(m.provider),
                available: m.enabled,
                healthy
            }
        })

        // Auto option is always first and always available
        const autoOption = {
            id:       "gateway-auto",
            name:     "Auto — Let Gateway Decide",
            provider: null,
            available: true,
            healthy:  true
        }

        return res.status(200).json({
            models: [autoOption, ...models]
        })
    } catch (error) {
        console.error("Error in getAvailableModelsController:", error.message)
        return res.status(500).json({ message: "Failed to retrieve model list." })
    }
}

/**
 * Formats a model ID into a human-readable display name.
 * Example: "gemini-3.1-flash-lite-preview" → "Gemini 3.1 Flash Lite Preview"
 * Example: "nvidia/nemotron-3-super-120b-a12b:free" → "Nemotron 3 Super 120B"
 * @private
 */
function _formatModelName(modelId, provider) {
    const displayNames = {
        "gemini-3.1-flash-lite-preview":          "Gemini 3.1 Flash Lite Preview",
        "gemini-3.1-flash-lite":                  "Gemini 3.1 Flash Lite",
        "nvidia/nemotron-3-super-120b-a12b:free": "Nemotron 3 Super 120B"
    }
    if (displayNames[modelId]) return displayNames[modelId]

    // Generic formatter: strip provider prefix (before /) and :free suffix
    let name = modelId.includes("/") ? modelId.split("/").pop() : modelId
    name = name.replace(/:free$/, "")
    // Title-case words, replacing hyphens/underscores with spaces
    return name
        .split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
}

/**
 * Formats a provider key into a display name.
 * @private
 */
function _formatProviderName(providerKey) {
    const names = {
        gemini:     "Google Gemini",
        openrouter: "OpenRouter"
    }
    return names[providerKey] || providerKey.charAt(0).toUpperCase() + providerKey.slice(1)
}


// ─── Interview Report Controller ─────────────────────────────────────────────

/**
 * @description Controller to generate interview report.
 * Accepts optional `requestedModel` body field for manual model selection.
 *
 * POST /api/interview
 */
async function generateInterViewReportController(req, res) {
    try {
        const resumeFile = req.file
        let resumeText   = ""
        if (resumeFile) {
            const resumeContent = await (new pdfParse.PDFParse(Uint8Array.from(resumeFile.buffer))).getText()
            resumeText = resumeContent.text
        }

        const { selfDescription, jobDescription } = req.body

        if (!jobDescription) {
            return res.status(400).json({ message: "Job description is required." })
        }
        if (!resumeText && (!selfDescription || !selfDescription.trim())) {
            return res.status(400).json({
                message: "Either a resume or self-description is required to generate a personalized plan."
            })
        }

        let daysUntilInterview = undefined
        if (req.body.daysUntilInterview !== undefined && req.body.daysUntilInterview !== null && req.body.daysUntilInterview !== "") {
            const parsed = Number(req.body.daysUntilInterview)
            if (!isNaN(parsed) && parsed > 0) {
                daysUntilInterview = parsed
            }
        }

        // Optional manual model override — null/"auto" → dynamic routing
        const requestedModel = (req.body.requestedModel && req.body.requestedModel !== "auto" && req.body.requestedModel !== "gateway-auto")
            ? req.body.requestedModel
            : null

        const { interviewReport: aiReport, metadata } = await generateInterviewReport({
            resume: resumeText,
            selfDescription,
            jobDescription,
            daysUntilInterview,
            requestedModel
        })

        // Persist to DB — existing schema unchanged
        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeText,
            selfDescription,
            jobDescription,
            daysUntilInterview,
            ...aiReport
        })

        // Attach metadata outside the AI response object — existing consumers are unaffected
        return res.status(201).json({
            message: "Interview Report generated successfully",
            interviewReport,
            aiMetadata: {
                requestId:         metadata.requestId,
                model:             metadata.model,
                modelDisplayName:  _formatModelName(metadata.model, metadata.provider),
                provider:          _formatProviderName(metadata.provider),
                selectionMode:     metadata.selectionMode,
                fallbackCount:     metadata.fallbackCount,
                totalRequestMs:    metadata.totalRequestMs
            }
        })
    } catch (error) {
        console.error("Error in generateInterViewReportController:", error.message)

        // MODEL_UNAVAILABLE — return structured error for frontend to display
        if (error instanceof AIError && error.code === "MODEL_UNAVAILABLE") {
            return res.status(503).json({
                message: error.message,
                code:    "MODEL_UNAVAILABLE",
                model:   error.model || null
            })
        }
        if (error instanceof AIError && error.code === "MODEL_NOT_FOUND") {
            return res.status(404).json({
                message: error.message,
                code:    "MODEL_NOT_FOUND",
                model:   error.model || null
            })
        }

        const status  = error instanceof AIError ? error.statusCode : 500
        const message = error instanceof AIError ? error.message : "Failed to generate interview report."
        return res.status(status).json({
            message,
            code: error.code || "INTERNAL_ERROR"
        })
    }
}


/**
 * @description Controller to get interview report by interview id.
 */
async function getInterviewReportByIdController(req, res) {
    const { interviewId } = req.params
    const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id }).lean()
    if (!interviewReport) {
        return res.status(401).json({ message: "Interview Report not found" })
    }
    return res.status(200).json({
        message: "Interview Report fetched successfully",
        interviewReport
    })
}

/**
 * @description Controller to get all interview reports of logged in user with pagination.
 */
async function getAllInterviewReportsController(req, res) {
    try {
        const page  = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20))
        const skip  = (page - 1) * limit

        const [interviewReports, total] = await Promise.all([
            interviewReportModel.find({ user: req.user.id })
                .sort({ isStarred: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select("jobDescription matchScore isStarred createdAt")
                .lean(),
            interviewReportModel.countDocuments({ user: req.user.id })
        ])

        const totalPages = Math.ceil(total / limit) || 1

        return res.status(200).json({
            message: "Interview reports fetched successfully.",
            interviewReports,
            reports: interviewReports,
            pagination: { page, limit, total, totalPages }
        })
    } catch (error) {
        console.error("Error in getAllInterviewReportsController:", error.message)
        return res.status(500).json({ message: "Failed to fetch interview reports.", error: error.message })
    }
}

/**
 * @description Controller to generate resume PDF.
 */
async function generateResumePdfController(req, res) {
    try {
        const { interviewReportId } = req.params
        const interviewReport = await interviewReportModel.findById(interviewReportId)

        if (!interviewReport) {
            return res.status(404).json({ message: "Interview report not found." })
        }

        const { resume, jobDescription, selfDescription } = interviewReport

        // Resume PDF always uses auto routing (no user-selected model override here)
        const { html, metadata } = await generateResumePdf({ resume, jobDescription, selfDescription })

        return res.status(200).json({
            html,
            aiMetadata: {
                requestId:      metadata.requestId,
                model:          metadata.model,
                provider:       _formatProviderName(metadata.provider),
                selectionMode:  metadata.selectionMode,
                totalRequestMs: metadata.totalRequestMs
            }
        })
    } catch (error) {
        console.error("Error in generateResumePdfController:", error.message)
        const status  = error instanceof AIError ? error.statusCode : 500
        const message = error instanceof AIError ? error.message : "Failed to generate resume HTML."
        return res.status(status).json({ message, code: error.code || "INTERNAL_ERROR" })
    }
}

/**
 * @description Controller to delete an interview report.
 */
async function deleteInterviewReportController(req, res) {
    try {
        const { interviewId } = req.params
        const deleted = await interviewReportModel.findOneAndDelete({ _id: interviewId, user: req.user.id })
        if (!deleted) {
            return res.status(404).json({ message: "Interview plan not found." })
        }
        return res.status(200).json({ message: "Interview plan deleted successfully." })
    } catch (error) {
        console.error("Error in deleteInterviewReportController:", error)
        return res.status(500).json({ message: "Failed to delete interview plan.", error: error.message })
    }
}

/**
 * @description Controller to toggle star status of an interview report.
 */
async function starInterviewReportController(req, res) {
    try {
        const { interviewId } = req.params
        const { isStarred }   = req.body

        const report = await interviewReportModel.findOneAndUpdate(
            { _id: interviewId, user: req.user.id },
            { isStarred: !!isStarred },
            { new: true }
        )

        if (!report) {
            return res.status(404).json({ message: "Interview plan not found." })
        }

        return res.status(200).json({
            message: isStarred ? "Interview plan starred successfully." : "Interview plan unstarred successfully.",
            interviewReport: report
        })
    } catch (error) {
        console.error("Error in starInterviewReportController:", error)
        return res.status(500).json({ message: "Failed to update star status.", error: error.message })
    }
}

module.exports = {
    getAvailableModelsController,
    generateInterViewReportController,
    getInterviewReportByIdController,
    getAllInterviewReportsController,
    generateResumePdfController,
    deleteInterviewReportController,
    starInterviewReportController
}