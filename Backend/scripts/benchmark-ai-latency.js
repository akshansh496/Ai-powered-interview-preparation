const path = require("path")
const fs = require("fs")
const { performance } = require("perf_hooks")

// Ensure environment variables are loaded
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const { GoogleGenAI } = require("@google/genai")
const { extractAndParseJson } = require("../src/services/ai/openrouter.provider")
const aiGateway = require("../src/services/ai/ai.gateway")

// ==========================================
// BENCHMARK CONFIGURATION
// ==========================================
const RUNS_PER_TARGET = 5
const REQUEST_TIMEOUT_MS = 30000

const BENCHMARK_SYSTEM_PROMPT = `You are an interview evaluation assistant.
Analyze the candidate response and return a concise JSON object containing:
1. score (number from 0 to 100)
2. strengths (array of strings or string)
3. weaknesses (array of strings or string)
4. recommendation (string)
Return ONLY valid JSON without markdown fences or additional conversational wrapper.`

const BENCHMARK_USER_PROMPT = `Candidate response:
I designed a REST API using Node.js and MongoDB. I added indexes to improve query performance and implemented JWT authentication.`

const COMBINED_PROMPT = `${BENCHMARK_SYSTEM_PROMPT}\n\n${BENCHMARK_USER_PROMPT}`

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function calculatePercentile(sortedValues, percentile) {
    if (!sortedValues || sortedValues.length === 0) return 0
    if (sortedValues.length === 1) return sortedValues[0]
    const index = (sortedValues.length - 1) * percentile
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    const weight = index - lower
    if (lower === upper) return sortedValues[lower]
    return Math.round(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight)
}

function calculateStatistics(runs) {
    const totalRuns = runs.length
    const successfulRuns = runs.filter(r => r.success)
    const failedRuns = runs.filter(r => !r.success)
    const successfulCount = successfulRuns.length
    const failedCount = failedRuns.length
    const failureRate = totalRuns > 0 ? ((failedCount / totalRuns) * 100).toFixed(1) : "0.0"

    if (successfulCount === 0) {
        return {
            totalRuns,
            successfulCount,
            failedCount,
            failureRate: `${failureRate}%`,
            minLatencyMs: null,
            maxLatencyMs: null,
            avgLatencyMs: null,
            p50LatencyMs: null,
            p95LatencyMs: null
        }
    }

    const latencies = successfulRuns.map(r => r.totalLatencyMs).sort((a, b) => a - b)
    const minLatencyMs = Math.min(...latencies)
    const maxLatencyMs = Math.max(...latencies)
    const sum = latencies.reduce((acc, curr) => acc + curr, 0)
    const avgLatencyMs = Math.round(sum / latencies.length)
    const p50LatencyMs = calculatePercentile(latencies, 0.50)
    const p95LatencyMs = calculatePercentile(latencies, 0.95)

    return {
        totalRuns,
        successfulCount,
        failedCount,
        failureRate: `${failureRate}%`,
        minLatencyMs,
        maxLatencyMs,
        avgLatencyMs,
        p50LatencyMs,
        p95LatencyMs
    }
}

// ==========================================
// DIRECT PROVIDER RUNNERS (Single attempt, No retries)
// ==========================================
async function runDirectOpenRouter(runIndex) {
    const apiKey = process.env.OPENROUTER_API_KEY
    const model = process.env.OPENROUTER_MODEL || "openrouter/free"
    const endpoint = "https://openrouter.ai/api/v1/chat/completions"

    const runRecord = {
        target: "Direct OpenRouter",
        provider: "openrouter",
        model,
        actualModel: null,
        runNumber: runIndex,
        startTime: new Date().toISOString(),
        endTime: null,
        totalLatencyMs: null,
        timeToFirstTokenMs: null,
        streamingUsed: false,
        fallbackUsed: false,
        inputTokens: null,
        outputTokens: null,
        success: false,
        error: null
    }

    const controller = new AbortController()
    const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const start = performance.now()

    try {
        const response = await globalThis.fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "InterviewAI-Latency-Benchmark"
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: BENCHMARK_SYSTEM_PROMPT },
                    { role: "user", content: BENCHMARK_USER_PROMPT }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2
            }),
            signal: controller.signal
        })
        clearTimeout(timeoutTimer)

        if (!response.ok) {
            let errorText = ""
            try {
                errorText = await response.text()
            } catch (_) {}
            throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
        }

        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content
        const parsed = extractAndParseJson(content, "benchmark response")

        if (typeof parsed !== "object" || parsed === null || typeof parsed.score !== "number") {
            throw new Error("Invalid benchmark JSON payload structure")
        }

        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.actualModel = data.model || model
        runRecord.inputTokens = data?.usage?.prompt_tokens ?? null
        runRecord.outputTokens = data?.usage?.completion_tokens ?? null
        runRecord.success = true
    } catch (err) {
        clearTimeout(timeoutTimer)
        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.success = false
        runRecord.error = err.name === "AbortError" ? `Timed out after ${REQUEST_TIMEOUT_MS}ms` : (err.message || String(err))
    }

    return runRecord
}

async function runDirectGemini(runIndex) {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview"

    const runRecord = {
        target: "Direct Gemini",
        provider: "gemini",
        model,
        actualModel: model,
        runNumber: runIndex,
        startTime: new Date().toISOString(),
        endTime: null,
        totalLatencyMs: null,
        timeToFirstTokenMs: null,
        streamingUsed: false,
        fallbackUsed: false,
        inputTokens: null,
        outputTokens: null,
        success: false,
        error: null
    }

    const start = performance.now()
    try {
        const ai = new GoogleGenAI({ apiKey })

        let timer
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms`)
                err.code = "REQUEST_TIMEOUT"
                reject(err)
            }, REQUEST_TIMEOUT_MS)
        })

        const generatePromise = ai.models.generateContent({
            model,
            contents: COMBINED_PROMPT,
            config: {
                responseMimeType: "application/json"
            }
        })

        const response = await Promise.race([
            generatePromise.finally(() => clearTimeout(timer)),
            timeoutPromise
        ])

        const parsed = JSON.parse(response.text)

        if (typeof parsed !== "object" || parsed === null || typeof parsed.score !== "number") {
            throw new Error("Invalid benchmark JSON payload structure")
        }

        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.inputTokens = response?.usageMetadata?.promptTokenCount ?? null
        runRecord.outputTokens = response?.usageMetadata?.candidatesTokenCount ?? null
        runRecord.success = true
    } catch (err) {
        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.success = false
        runRecord.error = err.message || String(err)
    }

    return runRecord
}

async function runAIRouterBenchmark(runIndex) {
    const runRecord = {
        target: "AI Router",
        provider: null,
        model: null,
        actualModel: null,
        runNumber: runIndex,
        startTime: new Date().toISOString(),
        endTime: null,
        totalLatencyMs: null,
        timeToFirstTokenMs: null,
        streamingUsed: false,
        fallbackUsed: false,
        inputTokens: null,
        outputTokens: null,
        success: false,
        error: null
    }

    const start = performance.now()
    try {
        let attemptCount = 0
        let executedProviderName = null
        let executedModel = null

        const result = await aiGateway.execute(
            "benchmarkTask",
            async (selectedProvider, modelOpts = {}) => {
                attemptCount++
                const currentModel = modelOpts.model || selectedProvider.model
                const currentTimeout = modelOpts.timeoutMs || REQUEST_TIMEOUT_MS
                executedProviderName = selectedProvider.name
                executedModel = currentModel

                if (selectedProvider.name === "openrouter") {
                    const apiKey = selectedProvider.getApiKey()
                    const controller = new AbortController()
                    const timer = setTimeout(() => controller.abort(), currentTimeout)

                    const response = await globalThis.fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`,
                            "HTTP-Referer": "http://localhost:3000",
                            "X-Title": "InterviewAI-Router-Benchmark"
                        },
                        body: JSON.stringify({
                            model: currentModel,
                            messages: [
                                { role: "system", content: BENCHMARK_SYSTEM_PROMPT },
                                { role: "user", content: BENCHMARK_USER_PROMPT }
                            ],
                            response_format: { type: "json_object" },
                            temperature: 0.2
                        }),
                        signal: controller.signal
                    })
                    clearTimeout(timer)

                    if (!response.ok) {
                        const err = new Error(`HTTP ${response.status}`)
                        err.status = response.status
                        throw err
                    }
                    const data = await response.json()
                    const content = data?.choices?.[0]?.message?.content
                    const parsed = extractAndParseJson(content, "benchmark router response")
                    return { parsed, data, provider: "openrouter" }
                } else if (selectedProvider.name === "gemini") {
                    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })
                    const response = await ai.models.generateContent({
                        model: currentModel,
                        contents: COMBINED_PROMPT,
                        config: { responseMimeType: "application/json" }
                    })
                    const parsed = JSON.parse(response.text)
                    return { parsed, response, provider: "gemini" }
                } else {
                    throw new Error(`Unsupported provider ${selectedProvider.name}`)
                }
            }
        )

        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.provider = executedProviderName
        runRecord.model = executedModel
        runRecord.fallbackUsed = attemptCount > 1

        if (result?.provider === "openrouter") {
            runRecord.actualModel = result.data?.model || executedModel
            runRecord.inputTokens = result.data?.usage?.prompt_tokens ?? null
            runRecord.outputTokens = result.data?.usage?.completion_tokens ?? null
        } else if (result?.provider === "gemini") {
            runRecord.actualModel = executedModel
            runRecord.inputTokens = result.response?.usageMetadata?.promptTokenCount ?? null
            runRecord.outputTokens = result.response?.usageMetadata?.candidatesTokenCount ?? null
        }

        runRecord.success = true
    } catch (err) {
        const end = performance.now()
        runRecord.endTime = new Date().toISOString()
        runRecord.totalLatencyMs = Math.round(end - start)
        runRecord.success = false
        runRecord.error = err.message || String(err)
    }

    return runRecord
}

// ==========================================
// MAIN BENCHMARK RUNNER
// ==========================================
async function main() {
    console.log("==================================================")
    console.log(" INTERVIEWAI — AI MODEL LATENCY BENCHMARK")
    console.log("==================================================")
    console.log(`Runs per target: ${RUNS_PER_TARGET}`)
    console.log(`Test mode: Sequential, 1 attempt per run (no retry distortion)`)
    console.log(`Timestamp: ${new Date().toISOString()}`)
    console.log("==================================================\n")

    const benchmarkResults = {
        meta: {
            timestamp: new Date().toISOString(),
            runsPerTarget: RUNS_PER_TARGET,
            nodeVersion: process.version,
            platform: process.platform,
            streamingEvaluated: false
        },
        targets: {}
    }

    // 1. Direct OpenRouter
    const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY)
    if (!hasOpenRouterKey) {
        console.log("⊘ OpenRouter: SKIPPED (OPENROUTER_API_KEY not found in environment)\n")
        benchmarkResults.targets.openrouter = { status: "SKIPPED", reason: "Missing API key" }
    } else {
        console.log(`▶ Benchmarking Provider: OpenRouter (Model: ${process.env.OPENROUTER_MODEL || "openrouter/free"})...`)
        const runs = []
        for (let i = 1; i <= RUNS_PER_TARGET; i++) {
            const result = await runDirectOpenRouter(i)
            runs.push(result)
            if (result.success) {
                console.log(`   [Run ${i}/${RUNS_PER_TARGET}] ✔ Success (${result.totalLatencyMs} ms, model: ${result.actualModel || result.model})`)
            } else {
                console.log(`   [Run ${i}/${RUNS_PER_TARGET}] ✖ Failed (${result.totalLatencyMs} ms) - Error: ${result.error}`)
            }
            if (i < RUNS_PER_TARGET) await new Promise(res => setTimeout(res, 500))
        }
        const stats = calculateStatistics(runs)
        benchmarkResults.targets.openrouter = {
            provider: "openrouter",
            configuredModel: process.env.OPENROUTER_MODEL || "openrouter/free",
            statistics: stats,
            runs
        }
        console.log("")
    }

    // 2. Direct Gemini
    const hasGeminiKey = Boolean(process.env.GOOGLE_GENAI_API_KEY)
    if (!hasGeminiKey) {
        console.log("⊘ Gemini: SKIPPED (GOOGLE_GENAI_API_KEY not found in environment)\n")
        benchmarkResults.targets.gemini = { status: "SKIPPED", reason: "Missing API key" }
    } else {
        console.log(`▶ Benchmarking Provider: Gemini (Model: ${process.env.GEMINI_MODEL || "gemini-3-flash-preview"})...`)
        const runs = []
        for (let i = 1; i <= RUNS_PER_TARGET; i++) {
            const result = await runDirectGemini(i)
            runs.push(result)
            if (result.success) {
                console.log(`   [Run ${i}/${RUNS_PER_TARGET}] ✔ Success (${result.totalLatencyMs} ms, tokens: in=${result.inputTokens ?? "N/A"} out=${result.outputTokens ?? "N/A"})`)
            } else {
                console.log(`   [Run ${i}/${RUNS_PER_TARGET}] ✖ Failed (${result.totalLatencyMs} ms) - Error: ${result.error}`)
            }
            if (i < RUNS_PER_TARGET) await new Promise(res => setTimeout(res, 500))
        }
        const stats = calculateStatistics(runs)
        benchmarkResults.targets.gemini = {
            provider: "gemini",
            configuredModel: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
            statistics: stats,
            runs
        }
        console.log("")
    }

    // 3. AI Router / Gateway
    console.log("▶ Benchmarking AI Router / Gateway...")
    const routerRuns = []
    for (let i = 1; i <= RUNS_PER_TARGET; i++) {
        const result = await runAIRouterBenchmark(i)
        routerRuns.push(result)
        if (result.success) {
            console.log(`   [Router Run ${i}/${RUNS_PER_TARGET}] ✔ Success (${result.totalLatencyMs} ms, Selected: ${result.provider}, Model: ${result.actualModel || result.model}${result.fallbackUsed ? " [FALLBACK TRIGGERED]" : ""})`)
        } else {
            console.log(`   [Router Run ${i}/${RUNS_PER_TARGET}] ✖ Failed (${result.totalLatencyMs} ms) - Error: ${result.error}`)
        }
        if (i < RUNS_PER_TARGET) await new Promise(res => setTimeout(res, 500))
    }
    const routerStats = calculateStatistics(routerRuns)
    benchmarkResults.targets.aiRouter = {
        target: "AI Router",
        statistics: routerStats,
        runs: routerRuns
    }
    console.log("")

    // ==========================================
    // SUMMARY CONSOLE OUTPUT
    // ==========================================
    console.log("========================================")
    console.log("AI LATENCY BENCHMARK SUMMARY")
    console.log("========================================")

    for (const [key, target] of Object.entries(benchmarkResults.targets)) {
        if (target.status === "SKIPPED") {
            console.log(`\nProvider/Target: ${key.toUpperCase()}`)
            console.log(`Status: SKIPPED (${target.reason})`)
            console.log("----------------------------------------")
            continue
        }

        const stats = target.statistics
        const title = target.provider
            ? `Provider: ${target.provider}\nModel:    ${target.configuredModel}`
            : `Target:   ${target.target}`

        console.log(`\n${title}`)
        console.log(`Runs:       ${stats.totalRuns}`)
        console.log(`Successful: ${stats.successfulCount}`)
        console.log(`Failed:     ${stats.failedCount} (Failure Rate: ${stats.failureRate})`)

        if (stats.successfulCount > 0) {
            console.log(`Min:        ${stats.minLatencyMs} ms`)
            console.log(`Average:    ${stats.avgLatencyMs} ms`)
            console.log(`P50:        ${stats.p50LatencyMs} ms`)
            console.log(`P95:        ${stats.p95LatencyMs} ms`)
            console.log(`Max:        ${stats.maxLatencyMs} ms`)
        } else {
            console.log(`Latency metrics unavailable due to 100% failure rate.`)
        }
        console.log("----------------------------------------")
    }
    console.log("========================================\n")

    // ==========================================
    // PERSIST RESULTS TO JSON FILE
    // ==========================================
    const resultsDir = path.join(__dirname, "../benchmark-results")
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true })
    }

    const resultsFilePath = path.join(resultsDir, "ai-latency-results.json")
    fs.writeFileSync(resultsFilePath, JSON.stringify(benchmarkResults, null, 2), "utf8")
    console.log(`✔ Benchmark results written to: ${resultsFilePath}\n`)
}

main().catch((err) => {
    console.error("Benchmark runner failed with unhandled error:", err)
    process.exit(1)
})
