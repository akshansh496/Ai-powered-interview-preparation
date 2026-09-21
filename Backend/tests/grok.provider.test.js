const test = require("node:test")
const assert = require("node:assert/strict")
const { GrokProvider } = require("../src/services/ai/grok.provider")

test("GrokProvider - Configuration and Availability tests", async (t) => {

    await t.test("should report availability based on XAI_API_KEY", () => {
        const origKey = process.env.XAI_API_KEY
        try {
            delete process.env.XAI_API_KEY
            const provider = new GrokProvider()
            assert.equal(provider.isAvailable(), false)

            process.env.XAI_API_KEY = "test-xai-key"
            assert.equal(provider.isAvailable(), true)
        } finally {
            if (origKey !== undefined) process.env.XAI_API_KEY = origKey
            else delete process.env.XAI_API_KEY
        }
    })

    await t.test("should throw CONFIGURATION_ERROR if XAI_API_KEY is missing when generating", async () => {
        const origKey = process.env.XAI_API_KEY
        delete process.env.XAI_API_KEY
        const provider = new GrokProvider()

        try {
            await assert.rejects(
                async () => await provider.generateInterviewReport({ jobDescription: "Test Job" }),
                (err) => err.code === "CONFIGURATION_ERROR"
            )
        } finally {
            if (origKey !== undefined) process.env.XAI_API_KEY = origKey
        }
    })
})

test("GrokProvider - API Execution and Structured Output tests", async (t) => {

    const validReportJson = {
        title: "Senior Backend Engineer",
        matchScore: 88,
        technicalQuestions: [
            { question: "How does Node.js event loop work?", intention: "Assess concurrency understanding", answer: "Explain phases: timers, poll, check" }
        ],
        behavioralQuestions: [
            { question: "Tell me about a time you handled an outage", intention: "Assess incident management", answer: "Use STAR method" }
        ],
        skillGaps: [
            { skill: "Kubernetes", severity: "medium" }
        ],
        preparationPlan: [
            { day: 1, focus: "Event loop & internals", tasks: ["Read libuv documentation"] }
        ]
    }

    await t.test("should successfully parse and validate structured interview report from Grok", async () => {
        const origKey = process.env.XAI_API_KEY
        process.env.XAI_API_KEY = "mock-key"

        let capturedRequest = null
        const mockFetch = async (url, options) => {
            capturedRequest = { url, options, body: JSON.parse(options.body) }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [
                        { message: { content: JSON.stringify(validReportJson) } }
                    ]
                })
            }
        }

        try {
            const provider = new GrokProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Backend Engineer",
                selfDescription: "5 years Node.js"
            })

            assert.equal(report.title, "Senior Backend Engineer")
            assert.equal(report.matchScore, 88)
            assert.equal(report.technicalQuestions.length, 1)
            assert.equal(report.behavioralQuestions.length, 1)
            assert.equal(report.skillGaps.length, 1)
            assert.equal(report.preparationPlan.length, 1)
            assert.equal(capturedRequest.options.headers.Authorization, "Bearer mock-key")
        } finally {
            if (origKey !== undefined) process.env.XAI_API_KEY = origKey
            else delete process.env.XAI_API_KEY
        }
    })

    await t.test("should successfully generate resume HTML from Grok", async () => {
        const origKey = process.env.XAI_API_KEY
        process.env.XAI_API_KEY = "mock-key"

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: JSON.stringify({ html: "<h1>Custom Resume</h1>" }) } }
                ]
            })
        })

        try {
            const provider = new GrokProvider({ fetchFn: mockFetch })
            const html = await provider.generateResumePdf({
                jobDescription: "Backend Engineer",
                selfDescription: "Node.js developer"
            })

            assert.equal(html, "<h1>Custom Resume</h1>")
        } finally {
            if (origKey !== undefined) process.env.XAI_API_KEY = origKey
            else delete process.env.XAI_API_KEY
        }
    })

    await t.test("should reject and throw VALIDATION_ERROR if Grok response fails Zod schema", async () => {
        const origKey = process.env.XAI_API_KEY
        process.env.XAI_API_KEY = "mock-key"

        const invalidReportJson = {
            title: "Software Engineer",
            // missing matchScore, technicalQuestions, etc.
        }

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: JSON.stringify(invalidReportJson) } }
                ]
            })
        })

        try {
            const provider = new GrokProvider({ fetchFn: mockFetch })
            await assert.rejects(
                async () => await provider.generateInterviewReport({ jobDescription: "Test Job" }),
                (err) => err.code === "VALIDATION_ERROR"
            )
        } finally {
            if (origKey !== undefined) process.env.XAI_API_KEY = origKey
            else delete process.env.XAI_API_KEY
        }
    })
})
