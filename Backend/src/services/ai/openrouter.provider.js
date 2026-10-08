const { AIProvider } = require("./provider.interface")
const { interviewReportSchema, resumePdfSchema, isTransientError } = require("./gemini.provider")

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free"
const MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES, 10) || 0
const TIMEOUT_MS = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 8000
const OPENROUTER_API_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

/**
 * Robust JSON extraction helper that safely handles:
 * 1. Raw JSON strings.
 * 2. Markdown JSON code blocks (```json ... ``` or ``` ... ```).
 * 3. Surrounding conversational text by extracting outermost { ... } or [ ... ].
 * Throws an error with code 'INVALID_RESPONSE' if all extraction and parsing attempts fail.
 */
function extractAndParseJson(content, contextName = "response") {
    if (!content || typeof content !== "string") {
        const err = new Error(`Empty or invalid content received from OpenRouter ${contextName}.`)
        err.code = "INVALID_RESPONSE"
        throw err
    }

    const trimmed = content.trim()

    // 1. Direct JSON parse attempt
    try {
        return JSON.parse(trimmed)
    } catch (_) {}

    // 2. Extract from Markdown code block (```json ... ``` or ``` ... ```)
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (codeBlockMatch && codeBlockMatch[1]) {
        try {
            return JSON.parse(codeBlockMatch[1].trim())
        } catch (_) {}
    }

    // 3. Locate outermost JSON object { ... }
    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = trimmed.substring(firstBrace, lastBrace + 1)
        try {
            return JSON.parse(candidate)
        } catch (_) {}
    }

    // 4. Locate outermost JSON array [ ... ]
    const firstBracket = trimmed.indexOf("[")
    const lastBracket = trimmed.lastIndexOf("]")
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const candidate = trimmed.substring(firstBracket, lastBracket + 1)
        try {
            return JSON.parse(candidate)
        } catch (_) {}
    }

    // If all extraction and parsing attempts fail
    const err = new Error(`Failed to parse OpenRouter ${contextName} as JSON.`)
    err.code = "INVALID_RESPONSE"
    throw err
}

/**
 * Small bounded retry mechanism with exponential backoff & jitter.
 */
async function executeWithRetry(fn, maxRetries = MAX_RETRIES, timeoutMs = TIMEOUT_MS) {
    let lastError
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn(timeoutMs)
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

class OpenRouterProvider extends AIProvider {
    constructor(options = {}) {
        super("openrouter", DEFAULT_MODEL)
        this.fetchFn = options.fetchFn || globalThis.fetch
        this.apiEndpoint = options.apiEndpoint || OPENROUTER_API_ENDPOINT
        this.lastActualModel = null
    }

    get model() {
        return process.env.OPENROUTER_MODEL || this.defaultModel
    }

    isAvailable() {
        return Boolean(process.env.OPENROUTER_API_KEY)
    }

    getApiKey() {
        const apiKey = process.env.OPENROUTER_API_KEY
        if (!apiKey) {
            const error = new Error("OPENROUTER_API_KEY is not configured.")
            error.code = "CONFIGURATION_ERROR"
            throw error
        }
        return apiKey
    }

    async generateInterviewReport({ resume, selfDescription, jobDescription, daysUntilInterview }, options = {}) {
        const apiKey = this.getApiKey()
        const modelToUse = options.model || this.model
        const timeoutMs = options.timeoutMs || parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || TIMEOUT_MS
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES

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

        const executeCall = async (currentTimeoutMs) => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), currentTimeoutMs)

            try {
                const response = await this.fetchFn(this.apiEndpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": "http://localhost:3000",
                        "X-Title": "InterviewAI"
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: [
                            { role: "system", content: systemMessage },
                            { role: "user", content: userMessage }
                        ],
                        response_format: { type: "json_object" },
                        temperature: 0.2
                    }),
                    signal: controller.signal
                })
                clearTimeout(timer)

                if (!response.ok) {
                    let errorBody = ""
                    try {
                        errorBody = await response.text()
                    } catch (_) {}

                    const err = new Error(`OpenRouter API error: HTTP ${response.status} - ${errorBody}`)
                    err.status = response.status
                    err.statusCode = response.status
                    throw err
                }

                const data = await response.json()
                if (data?.model) {
                    this.lastActualModel = data.model
                }

                const content = data?.choices?.[0]?.message?.content
                const parsed = extractAndParseJson(content, "interview report response")

                const validationResult = interviewReportSchema.safeParse(parsed)
                if (!validationResult.success) {
                    const err = new Error("OpenRouter AI response did not conform to the expected schema.")
                    err.code = "VALIDATION_ERROR"
                    err.details = validationResult.error.issues
                    throw err
                }

                return validationResult.data
            } catch (err) {
                clearTimeout(timer)
                if (err.name === "AbortError" || controller.signal.aborted) {
                    const timeoutErr = new Error(`AI request to OpenRouter model '${modelToUse}' timed out after ${currentTimeoutMs}ms.`)
                    timeoutErr.code = "REQUEST_TIMEOUT"
                    throw timeoutErr
                }
                throw err
            }
        }

        return await executeWithRetry(executeCall, maxRetries, timeoutMs)
    }

    async generateResumePdf({ resume, selfDescription, jobDescription }, options = {}) {
        const apiKey = this.getApiKey()
        const modelToUse = options.model || this.model
        const timeoutMs = options.timeoutMs || parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || TIMEOUT_MS
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES

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

        const executeCall = async (currentTimeoutMs) => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), currentTimeoutMs)

            try {
                const response = await this.fetchFn(this.apiEndpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": "http://localhost:3000",
                        "X-Title": "InterviewAI"
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: [
                            { role: "system", content: systemMessage },
                            { role: "user", content: userMessage }
                        ],
                        response_format: { type: "json_object" },
                        temperature: 0.2
                    }),
                    signal: controller.signal
                })
                clearTimeout(timer)

                if (!response.ok) {
                    let errorBody = ""
                    try {
                        errorBody = await response.text()
                    } catch (_) {}

                    const err = new Error(`OpenRouter API error: HTTP ${response.status} - ${errorBody}`)
                    err.status = response.status
                    err.statusCode = response.status
                    throw err
                }

                const data = await response.json()
                if (data?.model) {
                    this.lastActualModel = data.model
                }

                const content = data?.choices?.[0]?.message?.content
                const parsed = extractAndParseJson(content, "resume response")

                const validationResult = resumePdfSchema.safeParse(parsed)
                if (!validationResult.success) {
                    const err = new Error("OpenRouter AI resume response did not conform to the expected schema.")
                    err.code = "VALIDATION_ERROR"
                    err.details = validationResult.error.issues
                    throw err
                }

                return validationResult.data.html
            } catch (err) {
                clearTimeout(timer)
                if (err.name === "AbortError" || controller.signal.aborted) {
                    const timeoutErr = new Error(`AI request to OpenRouter model '${modelToUse}' timed out after ${currentTimeoutMs}ms.`)
                    timeoutErr.code = "REQUEST_TIMEOUT"
                    throw timeoutErr
                }
                throw err
            }
        }

        return await executeWithRetry(executeCall, maxRetries, timeoutMs)
    }
}

const openrouterProvider = new OpenRouterProvider()

module.exports = openrouterProvider
module.exports.OpenRouterProvider = OpenRouterProvider
module.exports.extractAndParseJson = extractAndParseJson
