const test = require("node:test")
const assert = require("node:assert/strict")
const { OpenRouterProvider, extractAndParseJson } = require("../src/services/ai/openrouter.provider")

test("OpenRouterProvider - extractAndParseJson helper unit tests", async (t) => {

    await t.test("1. should parse raw JSON string directly", () => {
        const raw = '{"title": "Software Engineer", "matchScore": 85}'
        const parsed = extractAndParseJson(raw)
        assert.deepEqual(parsed, { title: "Software Engineer", matchScore: 85 })
    })

    await t.test("2. should parse JSON from markdown code block (```json ... ```)", () => {
        const block = '```json\n{"title": "Software Engineer", "matchScore": 85}\n```'
        const parsed = extractAndParseJson(block)
        assert.deepEqual(parsed, { title: "Software Engineer", matchScore: 85 })
    })

    await t.test("3. should parse JSON surrounded by explanatory/conversational text", () => {
        const surrounded = 'Here is the interview report you requested:\n\n{"title": "Software Engineer", "matchScore": 85}\n\nHope this helps your interview preparation!'
        const parsed = extractAndParseJson(surrounded)
        assert.deepEqual(parsed, { title: "Software Engineer", matchScore: 85 })
    })

    await t.test("4. should throw INVALID_RESPONSE on invalid/non-JSON text", () => {
        const nonJson = "I am sorry, but I cannot assist with this request."
        assert.throws(
            () => extractAndParseJson(nonJson),
            (err) => err.code === "INVALID_RESPONSE"
        )
    })

    await t.test("5. should throw INVALID_RESPONSE on empty or null content", () => {
        assert.throws(
            () => extractAndParseJson(""),
            (err) => err.code === "INVALID_RESPONSE"
        )
        assert.throws(
            () => extractAndParseJson(null),
            (err) => err.code === "INVALID_RESPONSE"
        )
    })
})

test("OpenRouterProvider - Configuration and Availability tests", async (t) => {

    await t.test("should report availability based on OPENROUTER_API_KEY", () => {
        const origKey = process.env.OPENROUTER_API_KEY
        try {
            delete process.env.OPENROUTER_API_KEY
            const provider = new OpenRouterProvider()
            assert.equal(provider.isAvailable(), false)

            process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey"
            assert.equal(provider.isAvailable(), true)
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("should throw CONFIGURATION_ERROR if OPENROUTER_API_KEY is missing when generating", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        delete process.env.OPENROUTER_API_KEY
        const provider = new OpenRouterProvider()

        try {
            await assert.rejects(
                async () => await provider.generateInterviewReport({ jobDescription: "Test Job" }),
                (err) => err.code === "CONFIGURATION_ERROR"
            )
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
        }
    })
})

test("OpenRouterProvider - API Execution, Schema Validation, and Retry tests", async (t) => {

    const validReportJson = {
        title: "Senior Full Stack Engineer",
        matchScore: 92,
        technicalQuestions: [
            { question: "Explain JavaScript event loop and microtask queue", intention: "Assess asynchronous JS depth", answer: "Explain call stack, task queue, microtasks (Promises)" }
        ],
        behavioralQuestions: [
            { question: "Describe a challenging conflict in a sprint", intention: "Assess conflict resolution", answer: "Use STAR framework with proactive communication" }
        ],
        skillGaps: [
            { skill: "GraphQL", severity: "low" }
        ],
        preparationPlan: [
            { day: 1, focus: "Event loop & Async patterns", tasks: ["Review libuv and Node process.nextTick"] }
        ]
    }

    await t.test("1. should successfully parse raw JSON response passing Zod schema", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        let capturedRequest = null
        const mockFetch = async (url, options) => {
            capturedRequest = { url, options, body: JSON.parse(options.body) }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: "gen-123",
                    model: "meta-llama/llama-3.3-70b-instruct:free",
                    choices: [
                        { message: { content: JSON.stringify(validReportJson) } }
                    ]
                })
            }
        }

        try {
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Full Stack Engineer",
                selfDescription: "5 years Node.js and React"
            })

            assert.equal(report.title, "Senior Full Stack Engineer")
            assert.equal(report.matchScore, 92)
            assert.equal(report.technicalQuestions.length, 1)
            assert.equal(report.behavioralQuestions.length, 1)
            assert.equal(report.skillGaps.length, 1)
            assert.equal(report.preparationPlan.length, 1)
            assert.equal(capturedRequest.options.headers.Authorization, "Bearer mock-or-key")
            assert.equal(capturedRequest.options.headers["HTTP-Referer"], "http://localhost:3000")
            assert.equal(capturedRequest.options.headers["X-Title"], "InterviewAI")
            assert.equal(provider.lastActualModel, "meta-llama/llama-3.3-70b-instruct:free")
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("2. should extract and parse JSON inside markdown code blocks", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        const markdownWrapped = "```json\n" + JSON.stringify(validReportJson) + "\n```"

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: markdownWrapped } }
                ]
            })
        })

        try {
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Full Stack Engineer",
                selfDescription: "Node.js developer"
            })

            assert.equal(report.title, "Senior Full Stack Engineer")
            assert.equal(report.matchScore, 92)
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("3. should extract and parse JSON surrounded by conversational text", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        const surroundingTextContent = `Here is your customized interview preparation plan:\n\n${JSON.stringify(validReportJson)}\n\nGood luck with your interview!`

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: surroundingTextContent } }
                ]
            })
        })

        try {
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Full Stack Engineer",
                selfDescription: "Node.js developer"
            })

            assert.equal(report.title, "Senior Full Stack Engineer")
            assert.equal(report.matchScore, 92)
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("4. should throw INVALID_RESPONSE if OpenRouter response contains non-JSON text", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: "Internal service error occurred in upstream free provider." } }
                ]
            })
        })

        try {
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            await assert.rejects(
                async () => await provider.generateInterviewReport({ jobDescription: "Test Job" }),
                (err) => err.code === "INVALID_RESPONSE"
            )
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("5. should reject and throw VALIDATION_ERROR if OpenRouter response fails Zod schema", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

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
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            await assert.rejects(
                async () => await provider.generateInterviewReport({ jobDescription: "Test Job" }),
                (err) => err.code === "VALIDATION_ERROR"
            )
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("6. should successfully generate resume HTML from OpenRouter", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [
                    { message: { content: JSON.stringify({ html: "<h1>ATS Tailored Resume</h1>" }) } }
                ]
            })
        })

        try {
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const html = await provider.generateResumePdf({
                jobDescription: "Backend Engineer",
                selfDescription: "Node.js developer"
            })

            assert.equal(html, "<h1>ATS Tailored Resume</h1>")
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("7. should retry transient 429 and succeed on subsequent attempt", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        let callCount = 0
        const mockFetch = async () => {
            callCount++
            if (callCount === 1) {
                return {
                    ok: false,
                    status: 429,
                    text: async () => JSON.stringify({ error: { message: "Rate limit reached" } })
                }
            }
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
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Engineer",
                selfDescription: "5 years experience"
            })

            assert.equal(report.title, "Senior Full Stack Engineer")
            assert.equal(callCount, 2)
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })

    await t.test("8. should retry transient 503 and succeed on subsequent attempt", async () => {
        const origKey = process.env.OPENROUTER_API_KEY
        process.env.OPENROUTER_API_KEY = "mock-or-key"

        let callCount = 0
        const mockFetch = async () => {
            callCount++
            if (callCount === 1) {
                return {
                    ok: false,
                    status: 503,
                    text: async () => JSON.stringify({ error: { message: "Service Unavailable" } })
                }
            }
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
            const provider = new OpenRouterProvider({ fetchFn: mockFetch })
            const report = await provider.generateInterviewReport({
                jobDescription: "Senior Engineer",
                selfDescription: "5 years experience"
            })

            assert.equal(report.title, "Senior Full Stack Engineer")
            assert.equal(callCount, 2)
        } finally {
            if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey
            else delete process.env.OPENROUTER_API_KEY
        }
    })
})

