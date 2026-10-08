/**
 * verify-ai-models.js
 *
 * AI Model Availability Verification Script for InterviewAI.
 *
 * Performs:
 *  1. Gemini model discovery via @google/genai SDK
 *  2. OpenRouter free-model discovery via /api/v1/models
 *  3. Minimal real request verification for each candidate
 *  4. Structured-output compatibility check (interviewReportSchema subset)
 *  5. Prints a human-readable availability table
 *  6. Exits with code 0 if ≥1 provider verified, code 1 if none
 *
 * SECURITY:
 *  - API keys are NEVER printed or logged.
 *  - Only model IDs, latencies, and error categories are reported.
 */

"use strict"

const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const { GoogleGenAI } = require("@google/genai")

const VERIFY_TIMEOUT_MS = 25000  // 25 s per model verification attempt

// ── Minimal schema to test structured-output compatibility ─────────────────
// Must match the shape the real interviewReportSchema produces.
// We only verify the response contains these fields; full schema validation is
// left to production code.
const REQUIRED_REPORT_FIELDS = ["matchScore", "technicalQuestions", "behavioralQuestions", "skillGaps", "preparationPlan", "title"]

const VERIFY_SYSTEM_PROMPT = `You are an interview evaluation assistant.
Return ONLY a valid JSON object (no markdown fences, no extra text) with this exact shape:
{
  "title": "Software Engineer",
  "matchScore": 75,
  "technicalQuestions": [{"question": "string", "intention": "string", "answer": "string"}],
  "behavioralQuestions": [{"question": "string", "intention": "string", "answer": "string"}],
  "skillGaps": [{"skill": "string", "severity": "medium"}],
  "preparationPlan": [{"day": 1, "focus": "string", "tasks": ["string"]}]
}`

const VERIFY_USER_PROMPT = `Candidate: Junior developer applying for a Software Engineer role.
Job: Build REST APIs with Node.js.
Generate a minimal interview preparation report.`

// ── Utility ────────────────────────────────────────────────────────────────

function maskKey(key) {
    if (!key || key.length < 8) return "***"
    return key.slice(0, 4) + "..." + key.slice(-4)
}

function classifyError(err) {
    const msg = (err.message || "").toLowerCase()
    const status = err.status || err.statusCode
    if (status === 404 || msg.includes("404") || msg.includes("not found") || msg.includes("no endpoints")) return "MODEL_NOT_FOUND (404)"
    if (status === 401 || msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key")) return "AUTH_ERROR (401)"
    if (status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) return "RATE_LIMIT (429)"
    if (status === 503 || msg.includes("503") || msg.includes("overloaded") || msg.includes("unavailable")) return "SERVICE_UNAVAILABLE (503)"
    if (err.name === "AbortError" || msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT"
    if (msg.includes("json") || msg.includes("parse") || msg.includes("invalid response")) return "INVALID_RESPONSE"
    if (msg.includes("schema") || msg.includes("validation")) return "SCHEMA_VALIDATION_FAILED"
    return `ERROR: ${(err.message || String(err)).slice(0, 80)}`
}

function validateReportShape(parsed) {
    if (!parsed || typeof parsed !== "object") return false
    for (const field of REQUIRED_REPORT_FIELDS) {
        if (!(field in parsed)) return false
    }
    if (typeof parsed.matchScore !== "number") return false
    if (!Array.isArray(parsed.technicalQuestions)) return false
    if (!Array.isArray(parsed.behavioralQuestions)) return false
    if (!Array.isArray(parsed.skillGaps)) return false
    if (!Array.isArray(parsed.preparationPlan)) return false
    return true
}

function extractJson(content) {
    if (!content || typeof content !== "string") return null
    const trimmed = content.trim()
    try { return JSON.parse(trimmed) } catch (_) {}
    const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (mdMatch) try { return JSON.parse(mdMatch[1].trim()) } catch (_) {}
    const fb = trimmed.indexOf("{"), lb = trimmed.lastIndexOf("}")
    if (fb !== -1 && lb > fb) try { return JSON.parse(trimmed.slice(fb, lb + 1)) } catch (_) {}
    return null
}

// ── Gemini Discovery ────────────────────────────────────────────────────────

async function discoverGeminiModels(apiKey) {
    try {
        const ai = new GoogleGenAI({ apiKey })
        const result = await ai.models.list()
        const candidates = []
        for await (const model of result) {
            // Filter: must support generateContent AND be a flash/pro text model
            const name = model.name || ""
            const supportedMethods = model.supportedActions || model.supportedGenerationMethods || []
            const supportsGenerate = supportedMethods.includes("generateContent")
            const isTextModel = name.includes("gemini") && (name.includes("flash") || name.includes("pro") || name.includes("exp"))
            if (supportsGenerate && isTextModel) {
                // Extract clean model id (models/gemini-xxx → gemini-xxx)
                const modelId = name.startsWith("models/") ? name.slice(7) : name
                candidates.push(modelId)
            }
        }
        return candidates
    } catch (err) {
        const errClass = classifyError(err)
        console.error(`  [Gemini Discovery] Failed: ${errClass}`)
        return []
    }
}

// ── Gemini Verification ─────────────────────────────────────────────────────

async function verifyGeminiModel(apiKey, modelId) {
    const start = Date.now()
    try {
        const ai = new GoogleGenAI({ apiKey })
        const controller = { aborted: false }
        let timer

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller.aborted = true
                const e = new Error(`Timed out after ${VERIFY_TIMEOUT_MS}ms`)
                e.name = "AbortError"
                reject(e)
            }, VERIFY_TIMEOUT_MS)
        })

        const genPromise = ai.models.generateContent({
            model: modelId,
            contents: `${VERIFY_SYSTEM_PROMPT}\n\n${VERIFY_USER_PROMPT}`,
            config: { responseMimeType: "application/json" }
        })

        const response = await Promise.race([
            genPromise.finally(() => clearTimeout(timer)),
            timeoutPromise
        ])

        const latencyMs = Date.now() - start
        let parsed
        try { parsed = JSON.parse(response.text) } catch (_) { parsed = null }

        if (!parsed || !validateReportShape(parsed)) {
            return { modelId, success: false, latencyMs, errorCategory: "SCHEMA_VALIDATION_FAILED" }
        }

        return { modelId, success: true, latencyMs, errorCategory: null }
    } catch (err) {
        return { modelId, success: false, latencyMs: Date.now() - start, errorCategory: classifyError(err) }
    }
}

// ── OpenRouter Discovery ────────────────────────────────────────────────────

async function discoverOpenRouterModels(apiKey) {
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        const response = await fetch("https://openrouter.ai/api/v1/models", {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "InterviewAI-Verifier"
            },
            signal: controller.signal
        })
        clearTimeout(timer)

        if (!response.ok) {
            console.error(`  [OpenRouter Discovery] API error: HTTP ${response.status}`)
            return []
        }

        const data = await response.json()
        const models = data?.data || []

        // Filter: free models that support text generation
        const freeModels = models
            .filter(m => {
                if (!m.id) return false
                // Must end in :free or have pricing.prompt === "0"
                const isFree = m.id.endsWith(":free") || (m.pricing?.prompt === "0" || m.pricing?.prompt === 0)
                const isText = (m.architecture?.modality || "").includes("text") || 
                               (m.architecture?.input_modalities || []).includes("text")
                return isFree && isText
            })
            .map(m => m.id)
            .slice(0, 20) // Cap at 20 candidates to avoid excessive API calls

        return freeModels
    } catch (err) {
        console.error(`  [OpenRouter Discovery] Failed: ${classifyError(err)}`)
        return []
    }
}

// ── OpenRouter Verification ─────────────────────────────────────────────────

async function verifyOpenRouterModel(apiKey, modelId) {
    const start = Date.now()
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "InterviewAI-Verifier"
            },
            body: JSON.stringify({
                model: modelId,
                messages: [
                    { role: "system", content: VERIFY_SYSTEM_PROMPT },
                    { role: "user", content: VERIFY_USER_PROMPT }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 800
            }),
            signal: controller.signal
        })
        clearTimeout(timer)

        const latencyMs = Date.now() - start

        if (!response.ok) {
            let body = ""
            try { body = await response.text() } catch (_) {}
            const err = new Error(`HTTP ${response.status}: ${body.slice(0, 120)}`)
            err.status = response.status
            return { modelId, success: false, latencyMs, errorCategory: classifyError(err) }
        }

        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content
        const parsed = extractJson(content)

        if (!parsed || !validateReportShape(parsed)) {
            return { modelId, success: false, latencyMs, errorCategory: "SCHEMA_VALIDATION_FAILED" }
        }

        return { modelId, success: true, latencyMs, errorCategory: null }
    } catch (err) {
        return { modelId, success: false, latencyMs: Date.now() - start, errorCategory: classifyError(err) }
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const GEMINI_KEY = process.env.GOOGLE_GENAI_API_KEY
    const OR_KEY = process.env.OPENROUTER_API_KEY

    console.log("========================================")
    console.log("  AI MODEL AVAILABILITY VERIFICATION")
    console.log("========================================")
    console.log(`Timestamp: ${new Date().toISOString()}`)
    console.log(`Verification timeout: ${VERIFY_TIMEOUT_MS}ms per model`)
    console.log(`Gemini key present: ${GEMINI_KEY ? `YES (${maskKey(GEMINI_KEY)})` : "NO"}`)
    console.log(`OpenRouter key present: ${OR_KEY ? `YES (${maskKey(OR_KEY)})` : "NO"}`)
    console.log("")

    const verifiedGemini = []
    const rejectedGemini = []
    const verifiedOpenRouter = []
    const rejectedOpenRouter = []

    // ── Gemini ──────────────────────────────────────────────────────────────
    console.log("══════════════ GEMINI ══════════════")
    if (!GEMINI_KEY) {
        console.log("  SKIPPED — GOOGLE_GENAI_API_KEY not set")
    } else {
        console.log("  Step 1/2: Discovering models via @google/genai SDK...")
        const geminiCandidates = await discoverGeminiModels(GEMINI_KEY)
        
        if (geminiCandidates.length === 0) {
            console.log("  No Gemini models discovered. Check API key permissions.")
        } else {
            console.log(`  Discovered ${geminiCandidates.length} candidate(s): ${geminiCandidates.join(", ")}`)
            console.log(`\n  Step 2/2: Verifying each candidate with a minimal real request...`)
            
            for (const modelId of geminiCandidates) {
                process.stdout.write(`    Testing ${modelId}... `)
                const result = await verifyGeminiModel(GEMINI_KEY, modelId)
                if (result.success) {
                    console.log(`✓ (${result.latencyMs}ms — structured output compatible)`)
                    verifiedGemini.push(result)
                } else {
                    console.log(`✗ ${result.errorCategory}`)
                    rejectedGemini.push(result)
                }
                // Small delay to avoid hammering the API
                await new Promise(r => setTimeout(r, 300))
            }
        }
    }
    console.log("")

    // ── OpenRouter ───────────────────────────────────────────────────────────
    console.log("══════════════ OPENROUTER ══════════════")
    if (!OR_KEY) {
        console.log("  SKIPPED — OPENROUTER_API_KEY not set")
    } else {
        console.log("  Step 1/2: Discovering free models via /api/v1/models catalog...")
        const orCandidates = await discoverOpenRouterModels(OR_KEY)
        
        if (orCandidates.length === 0) {
            console.log("  No OpenRouter free models discovered.")
        } else {
            console.log(`  Discovered ${orCandidates.length} free candidate(s)`)
            console.log(`\n  Step 2/2: Verifying top candidates (max 6)...`)
            
            // Verify up to 6 to keep total runtime reasonable
            const toVerify = orCandidates.slice(0, 6)
            for (const modelId of toVerify) {
                process.stdout.write(`    Testing ${modelId}... `)
                const result = await verifyOpenRouterModel(OR_KEY, modelId)
                if (result.success) {
                    console.log(`✓ (${result.latencyMs}ms — structured output compatible)`)
                    verifiedOpenRouter.push(result)
                } else {
                    console.log(`✗ ${result.errorCategory}`)
                    rejectedOpenRouter.push(result)
                }
                await new Promise(r => setTimeout(r, 500))
            }
        }
    }
    console.log("")

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log("========================================")
    console.log("  VERIFICATION RESULTS")
    console.log("========================================")
    console.log("")
    console.log("Gemini — VERIFIED:")
    if (verifiedGemini.length === 0) {
        console.log("  (none)")
    } else {
        for (const r of verifiedGemini) {
            console.log(`  ✓ ${r.modelId}  (avg latency: ${r.latencyMs}ms)`)
        }
    }
    console.log("")
    console.log("Gemini — REJECTED:")
    if (rejectedGemini.length === 0) {
        console.log("  (none)")
    } else {
        for (const r of rejectedGemini) {
            console.log(`  ✗ ${r.modelId}  → ${r.errorCategory}`)
        }
    }
    console.log("")
    console.log("OpenRouter — VERIFIED:")
    if (verifiedOpenRouter.length === 0) {
        console.log("  (none)")
    } else {
        for (const r of verifiedOpenRouter) {
            console.log(`  ✓ ${r.modelId}  (avg latency: ${r.latencyMs}ms)`)
        }
    }
    console.log("")
    console.log("OpenRouter — REJECTED:")
    if (rejectedOpenRouter.length === 0) {
        console.log("  (none)")
    } else {
        for (const r of rejectedOpenRouter) {
            console.log(`  ✗ ${r.modelId}  → ${r.errorCategory}`)
        }
    }
    console.log("")
    console.log("========================================")
    console.log("  RECOMMENDED .env CONFIGURATION")
    console.log("========================================")
    console.log("")
    if (verifiedGemini.length >= 1) {
        // Sort by latency (fastest first)
        verifiedGemini.sort((a, b) => a.latencyMs - b.latencyMs)
        console.log(`GEMINI_MODEL=${verifiedGemini[0].modelId}`)
        if (verifiedGemini.length >= 2) {
            console.log(`GEMINI_SECONDARY_MODEL=${verifiedGemini[1].modelId}`)
        }
    } else {
        console.log("# No verified Gemini models — do not configure Gemini primary/secondary")
    }
    if (verifiedOpenRouter.length >= 1) {
        verifiedOpenRouter.sort((a, b) => a.latencyMs - b.latencyMs)
        console.log(`OPENROUTER_PRIMARY_MODEL=${verifiedOpenRouter[0].modelId}`)
        if (verifiedOpenRouter.length >= 2) {
            console.log(`OPENROUTER_SECONDARY_MODEL=${verifiedOpenRouter[1].modelId}`)
        }
    } else {
        console.log("# No verified OpenRouter free models — do not configure OpenRouter primary/secondary")
    }
    console.log(`OPENROUTER_MODEL=openrouter/free   # Final availability fallback — always keep`)
    console.log("")

    const totalVerified = verifiedGemini.length + verifiedOpenRouter.length
    if (totalVerified === 0) {
        console.log("❌ No models verified successfully. Check API keys and network connectivity.")
        process.exit(1)
    } else {
        console.log(`✅ ${totalVerified} model(s) verified successfully.`)
        process.exit(0)
    }
}

main().catch(err => {
    console.error("Verification script failed:", err.message)
    process.exit(1)
})
