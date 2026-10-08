const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const { AIProvider } = require("./provider.interface")

// Configuration constants with environment variable overrides
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview"
const MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES, 10) || 0
const TIMEOUT_MS = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 8000

let genAIClient = null

function getGenAIClient() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) {
        const error = new Error("GOOGLE_GENAI_API_KEY is not configured.")
        error.code = "CONFIGURATION_ERROR"
        throw error
    }
    if (!genAIClient) {
        genAIClient = new GoogleGenAI({ apiKey })
    }
    return genAIClient
}

// Schemas for structured output
const technicalQuestionSchema = z.object({
    question: z.string().describe("The technical question can be asked in the interview"),
    intention: z.string().describe("The intention of interviewer behind asking this question"),
    answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
})

const behavioralQuestionSchema = z.object({
    question: z.string().describe("The behavioral question can be asked in the interview"),
    intention: z.string().describe("The intention of interviewer behind asking this question"),
    answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
})

const skillGapSchema = z.object({
    skill: z.string().describe("The skill which the candidate is lacking"),
    severity: z.enum(["low", "medium", "high"]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
})

const preparationDaySchema = z.object({
    day: z.number().describe("The day number in the preparation plan, starting from 1. If daysUntilInterview is specified, the preparationPlan array must contain exactly that number of entries."),
    focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures, system design, mock interviews etc."),
    tasks: z.array(z.string()).describe("List of tasks to be done on this day to follow the preparation plan, e.g. read a specific book or article, solve a set of problems, watch a video etc.")
})

const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job describe"),
    technicalQuestions: z.array(technicalQuestionSchema).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(behavioralQuestionSchema).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(skillGapSchema).describe("List of skill gaps in the candidate's profile along with their severity"),
    preparationPlan: z.array(preparationDaySchema).describe("A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively"),
    title: z.string().describe("The title of the job for which the interview report is generated")
})

const resumePdfSchema = z.object({
    html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
})

/**
 * Checks if an error is considered transient and eligible for retry.
 */
function isTransientError(error) {
    if (!error) return false
    const message = (error.message || "").toLowerCase()
    const status = error.status || error.statusCode || (error.response && error.response.status)
    const code = error.code

    if (code === "REQUEST_TIMEOUT" || code === "TIMEOUT" || error.name === "AbortError") {
        return true
    }

    // Rate limits, server overload, temporary network issues
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
        return true
    }

    if (
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("rate limit") ||
        message.includes("overloaded") ||
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("econnreset") ||
        message.includes("etimedout") ||
        message.includes("fetch failed") ||
        message.includes("service unavailable")
    ) {
        return true
    }

    return false
}

/**
 * Executes a function with a strict timeout.
 */
function withTimeout(promise, timeoutMs) {
    let timer
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const timeoutError = new Error(`AI request to Gemini timed out after ${timeoutMs}ms.`)
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
            // Exponential backoff: attempt 0 -> ~400ms, attempt 1 -> ~800ms
            const delay = Math.min(2000, 300 * Math.pow(2, attempt) + Math.random() * 100)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }
    throw lastError
}

class GeminiProvider extends AIProvider {
    constructor() {
        super("gemini", DEFAULT_MODEL)
    }

    get model() {
        return process.env.GEMINI_MODEL || this.defaultModel
    }

    isAvailable() {
        return Boolean(process.env.GOOGLE_GENAI_API_KEY)
    }

    async generateInterviewReport({ resume, selfDescription, jobDescription, daysUntilInterview }, options = {}) {
        const ai = getGenAIClient()
        const modelToUse = options.model || this.model
        const timeoutMs = options.timeoutMs || parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || TIMEOUT_MS
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES

        const timingInstruction = daysUntilInterview
            ? `The candidate has exactly ${daysUntilInterview} day(s) until their actual interview. The preparationPlan array MUST contain exactly ${daysUntilInterview} entries (one per day, day 1 through day ${daysUntilInterview}), with the workload and topic depth per day scaled realistically to fit that timeframe. If the timeframe is very short (1-2 days), prioritize only the highest-impact topics and skip lower-priority skill gaps rather than cramming everything in.`
            : `The candidate has not specified a deadline. Generate a sensible default preparation plan (typically 5-7 days) covering all identified skill gaps at a reasonable pace.`

        const prompt = `Generate an interview report for a candidate with the following details:
Resume: ${resume || "N/A"}
Self Description: ${selfDescription || "N/A"}
Job Description: ${jobDescription}

${timingInstruction}`

        const executeCall = async () => {
            const response = await ai.models.generateContent({
                model: modelToUse,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: zodToJsonSchema(interviewReportSchema)
                }
            })

            let parsed
            try {
                parsed = JSON.parse(response.text)
            } catch (parseError) {
                const err = new Error("Failed to parse Gemini response as JSON.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            const validationResult = interviewReportSchema.safeParse(parsed)
            if (!validationResult.success) {
                const err = new Error("AI response did not conform to the expected schema.")
                err.code = "VALIDATION_ERROR"
                err.details = validationResult.error.issues
                throw err
            }

            return validationResult.data
        }

        return await executeWithRetry(executeCall, maxRetries, timeoutMs)
    }

    async generateResumePdf({ resume, selfDescription, jobDescription }, options = {}) {
        const ai = getGenAIClient()
        const modelToUse = options.model || this.model
        const timeoutMs = options.timeoutMs || parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || TIMEOUT_MS
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES

        const prompt = `Generate resume for a candidate with the following details:
Resume: ${resume || "N/A"}
Self Description: ${selfDescription || "N/A"}
Job Description: ${jobDescription}

the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.`

        const executeCall = async () => {
            const response = await ai.models.generateContent({
                model: modelToUse,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: zodToJsonSchema(resumePdfSchema)
                }
            })

            let parsed
            try {
                parsed = JSON.parse(response.text)
            } catch (parseError) {
                const err = new Error("Failed to parse Gemini resume response as JSON.")
                err.code = "INVALID_RESPONSE"
                throw err
            }

            const validationResult = resumePdfSchema.safeParse(parsed)
            if (!validationResult.success) {
                const err = new Error("AI resume response did not conform to the expected schema.")
                err.code = "VALIDATION_ERROR"
                err.details = validationResult.error.issues
                throw err
            }

            return validationResult.data.html
        }

        return await executeWithRetry(executeCall, maxRetries, timeoutMs)
    }
}

const geminiProvider = new GeminiProvider()

module.exports = geminiProvider
module.exports.GeminiProvider = GeminiProvider
module.exports.interviewReportSchema = interviewReportSchema
module.exports.resumePdfSchema = resumePdfSchema
module.exports.isTransientError = isTransientError
