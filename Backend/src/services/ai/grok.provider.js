const { AIProvider } = require("./provider.interface")
const { interviewReportSchema, resumePdfSchema, isTransientError } = require("./gemini.provider")

const DEFAULT_MODEL = process.env.GROK_MODEL || "grok-2-latest"
const MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES, 10) || 2
const TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 60000
const XAI_API_ENDPOINT = "https://api.x.ai/v1/chat/completions"

/**
 * Executes a function with a timeout using AbortController or Promise.race.
 */
function withTimeout(promise, timeoutMs) {
    let timer
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const timeoutError = new Error(`AI request to Grok timed out after ${timeoutMs}ms.`)
            timeoutError.code = "REQUEST_TIMEOUT"
            reject(timeoutError)
        }, timeoutMs)
    })

    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        timeoutPromise
    ])
}

/**
 * Small bounded retry mechanism with exponential backoff & jitter.
 */
async function executeWithRetry(fn, maxRetries = MAX_RETRIES, timeoutMs = TIMEOUT_MS) {
    let lastError
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await withTimeout(fn(), timeoutMs)
        } catch (error) {
            lastError = error
            const canRetry = attempt < maxRetries && isTransientError(error)
            if (!canRetry) {
                break
            }
            const delay = Math.min(2000, 300 * Math.pow(2, attempt) + Math.random() * 100)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }
    throw lastError
}

class GrokProvider extends AIProvider {
    constructor(options = {}) {
        super("grok", DEFAULT_MODEL)
        this.fetchFn = options.fetchFn || globalThis.fetch
        this.apiEndpoint = options.apiEndpoint || XAI_API_ENDPOINT
    }

    get model() {
        return process.env.GROK_MODEL || this.defaultModel
    }

    isAvailable() {
        return Boolean(process.env.XAI_API_KEY)
    }

    getApiKey() {
        const apiKey = process.env.XAI_API_KEY
        if (!apiKey) {
            const error = new Error("XAI_API_KEY is not configured.")
            error.code = "CONFIGURATION_ERROR"
            throw error
        }
        return apiKey
    }

    async generateInterviewReport({ resume, selfDescription, jobDescription, daysUntilInterview }, options = {}) {
        const apiKey = this.getApiKey()
        const modelToUse = options.model || this.model

        const timingInstruction = daysUntilInterview
            ? `The candidate has exactly ${daysUntilInterview} day(s) until their actual interview. The preparationPlan array MUST contain exactly ${daysUntilInterview} entries (one per day, day 1 through day ${daysUntilInterview}), with the workload and topic depth per day scaled realistically to fit that timeframe. If the timeframe is very short (1-2 days), prioritize only the highest-impact topics and skip lower-priority skill gaps rather than cramming everything in.`
            : `The candidate has not specified a deadline. Generate a sensible default preparation plan (typically 5-7 days) covering all identified skill gaps at a reasonable pace.`

        const systemMessage = `You are an expert technical interviewer and career strategist.
Generate an interview preparation report strictly as a valid JSON object matching this schema:
{
  "title": "string (The title of the job for which the interview report is generated)",
  "matchScore": number (0-100 indicating profile match score),
  "technicalQuestions": [
    { "question": "string", "intention": "string", "answer": "string" }
  ],
  "behavioralQuestions": [
    { "question": "string", "intention": "string", "answer": "string" }
  ],
  "skillGaps": [
    { "skill": "string", "severity": "low" | "medium" | "high" }
  ],
  "preparationPlan": [
    { "day": number (starting at 1), "focus": "string", "tasks": ["string"] }
  ]
}
Return ONLY valid JSON without markdown fences, extra commentary, or conversational wrapper.`

        const userMessage = `Candidate details:
Resume: ${resume || "N/A"}
Self Description: ${selfDescription || "N/A"}
Job Description: ${jobDescription}

${timingInstruction}`

        const executeCall = async () => {
            const response = await this.fetchFn(this.apiEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        { role: "system", content: systemMessage },
                        { role: "user", content: userMessage }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.2
                })
            })

            if (!response.ok) {
                let errorBody = ""
                try {
                    errorBody = await response.text()
                } catch (_) {}

                const err = new Error(`Grok API error: HTTP ${response.status} - ${errorBody}`)
                err.status = response.status
                err.statusCode = response.status
                throw err
            }

            const data = await response.json()
            const content = data?.choices?.[0]?.message?.content

            if (!content) {
                const err = new Error("Empty content received from Grok API.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            let parsed
            try {
                parsed = JSON.parse(content)
            } catch (parseError) {
                const err = new Error("Failed to parse Grok response as JSON.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            const validationResult = interviewReportSchema.safeParse(parsed)
            if (!validationResult.success) {
                const err = new Error("Grok AI response did not conform to the expected schema.")
                err.code = "VALIDATION_ERROR"
                err.details = validationResult.error.issues
                throw err
            }

            return validationResult.data
        }

        return await executeWithRetry(executeCall)
    }

    async generateResumePdf({ resume, selfDescription, jobDescription }, options = {}) {
        const apiKey = this.getApiKey()
        const modelToUse = options.model || this.model

        const systemMessage = `You are an expert resume writer.
Generate an ATS-friendly tailored resume in HTML format.
The response must be a JSON object with a single field "html" containing clean, professional HTML.
Example: { "html": "<!DOCTYPE html><html>...</html>" }
Return ONLY valid JSON without markdown wrapping.`

        const userMessage = `Generate resume for a candidate with the following details:
Resume: ${resume || "N/A"}
Self Description: ${selfDescription || "N/A"}
Job Description: ${jobDescription}

The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience.
The content should be ATS friendly, simple, and professional. 1-2 pages long when converted to PDF.`

        const executeCall = async () => {
            const response = await this.fetchFn(this.apiEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        { role: "system", content: systemMessage },
                        { role: "user", content: userMessage }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.2
                })
            })

            if (!response.ok) {
                let errorBody = ""
                try {
                    errorBody = await response.text()
                } catch (_) {}

                const err = new Error(`Grok API error: HTTP ${response.status} - ${errorBody}`)
                err.status = response.status
                err.statusCode = response.status
                throw err
            }

            const data = await response.json()
            const content = data?.choices?.[0]?.message?.content

            if (!content) {
                const err = new Error("Empty content received from Grok resume API.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            let parsed
            try {
                parsed = JSON.parse(content)
            } catch (parseError) {
                const err = new Error("Failed to parse Grok resume response as JSON.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            const validationResult = resumePdfSchema.safeParse(parsed)
            if (!validationResult.success) {
                const err = new Error("Grok AI resume response did not conform to the expected schema.")
                err.code = "VALIDATION_ERROR"
                err.details = validationResult.error.issues
                throw err
            }

            return validationResult.data.html
        }

        return await executeWithRetry(executeCall)
    }
}

const grokProvider = new GrokProvider()

module.exports = grokProvider
module.exports.GrokProvider = GrokProvider
