# Project Architecture & Directory Structure

> [!IMPORTANT]
> **Maintenance Rule:** Whenever files or folders are added, removed, moved, or renamed, or when major architectural patterns change, this document (`PROJECT_STRUCTURE.md`) **must be updated immediately** to reflect the current state of the codebase.

---

## 1. High-Level Architecture Overview

This repository is a full-stack, AI-powered interview preparation platform featuring an **Intelligent AI Gateway** that evaluates runtime health, reliability, latency, and availability to dynamically route requests across multiple AI providers (Google Gemini and OpenRouter):

```text
                         InterviewAI
                              │
                              ▼
                         AI Service
                              │
                              ▼
                        AI GATEWAY
                              │
                              ▼
                    Provider Evaluation
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
            Gemini                      OpenRouter
               │                             │
               │                             ▼
               │                      OpenRouter Router
               │                             │
               │                      Underlying Model
               │                             │
               └──────────────┬──────────────┘
                              │
                              ▼
                         AI Response
                              │
                              ▼
                      JSON Extraction
                              │
                              ▼
                       Zod Validation
                              │
                              ▼
                           Result
```

### Core Architectural Principles
1. **Provider-Agnostic Application Layer**: Controllers interact exclusively with `ai.service.js` and have no knowledge of underlying models or vendors.
2. **Dynamic AI Gateway & Runtime Routing**: `ai.gateway.js` and `routing.engine.js` dynamically score and rank candidate providers at runtime based on real-time availability, health, rate-limit state (HTTP 429 cooldowns), historical success rates, and rolling response latency. There is **no hardcoded default provider**.
3. **Resilient Dynamic Fallback**: If a selected provider encounters transient infrastructure failure (HTTP 429, 500, 502, 503, 504, timeout), the gateway re-evaluates remaining providers, enforces loop protection, and transparently routes to the next best candidate.
4. **Common Provider Contract**: All AI providers implement `AIProvider` (`provider.interface.js`), enforcing uniform capabilities and validation against shared Zod schemas (`interviewReportSchema`, `resumePdfSchema`).
5. **Resilience & Protection**: In-memory sliding window rate limiting, bounded exponential retry backoff, request timeout guards, and sanitized error normalization (`AIError`) prevent credential leaks.

---

## 2. Complete Project Directory Tree

```
Ai Powered Interview preparation/
│
├── .agents/
│   └── rules/
│       └── project-structure.md          # Rule for AI assistants to keep PROJECT_STRUCTURE.md updated
│
├── AGENTS.md                             # AI Pair Programmer guidance & synchronization mandate
├── INTERVIEWAI_AI_ROUTER_ANTIGRAVITY_SPEC.md # Scaling & architecture roadmap spec
├── PROJECT_STATUS.md                     # Single source of truth for project development stages & roadmap
├── PROJECT_STRUCTURE.md                  # This file (Project tree & module documentation)
│
├── Backend/
│   ├── .env.example                      # Template of environment variables for server and AI configuration
│   ├── benchmark-results/                # Benchmark latency outputs (JSON logs and telemetry)
│   │   └── ai-latency-results.json       # Generated latency results and statistical distribution
│   ├── package.json                      # Backend dependencies & scripts (test, benchmark:ai, dev)
│   ├── package-lock.json                 # Dependency lockfile
│   ├── scripts/
│   │   └── benchmark-ai-latency.js       # Standalone latency benchmark runner across AI providers
│   ├── server.js                         # Application entry point (Database connection & HTTP listener)
│   ├── src/
│   │   ├── app.js                        # Express setup: 2MB payload limits, CORS, cookie-parser, routing
│   │   ├── config/
│   │   │   └── database.js               # MongoDB connection logic via Mongoose
│   │   ├── controllers/
│   │   │   ├── auth.controller.js        # Register, login, logout, get user profile
│   │   │   └── interview.controller.js   # Generate plan, paginated reports, delete, star, resume PDF
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js        # JWT validation & token blacklist verification
│   │   │   ├── file.middleware.js        # Multer configuration for resume upload (memory storage)
│   │   │   └── rateLimiter.middleware.js # In-memory sliding window rate limiter for expensive AI endpoints
│   │   ├── models/
│   │   │   ├── blacklist.model.js        # Blacklisted JWT tokens for secure logout
│   │   │   ├── interviewReport.model.js  # Schema with compound index ({ user: 1, isStarred: -1, createdAt: -1 })
│   │   │   └── user.model.js             # User accounts schema with password hashing
│   │   ├── routes/
│   │   │   ├── auth.routes.js            # Endpoints: /api/auth (register, login, logout, me)
│   │   │   └── interview.routes.js       # Endpoints: /api/interview (generate, reports, pdf, star, delete)
│   │   └── services/
│   │       ├── ai.service.js             # Application boundary for AI operations & error normalization
│   │       └── ai/
│   │           ├── provider.interface.js # Abstract base class defining the AIProvider contract
│   │           ├── provider.registry.js  # Centralized provider registry mapping IDs to AIProvider instances
│   │           ├── model.registry.js     # Centralized model configuration, priorities, and fallback designation
│   │           ├── model.health.js       # In-memory circuit breaker & health tracking per individual model
│   │           ├── routing.engine.js     # Health tracking, telemetry metrics, and suitability scoring
│   │           ├── ai.gateway.js         # Intelligent AI Gateway for dynamic evaluation, execution, & fallback
│   │           ├── ai.router.js          # Model-aware router delegating to AI Gateway
│   │           ├── gemini.provider.js    # Google Gemini provider implementation with bounded retries
│   │           └── openrouter.provider.js # OpenRouter provider with multi-format JSON extraction & free model support
│   └── tests/
│       ├── ai.service.test.js            # Unit tests for error normalization & key sanitization
│       ├── ai.gateway.test.js            # Unit tests for AI Gateway dynamic provider selection & fallback
│       ├── model.routing.test.js         # Comprehensive unit & resilience test suite for model-aware routing
│       ├── routing.engine.test.js        # Unit tests for suitability scoring, rate limits, and health tracking
│       ├── ai.router.test.js             # Unit tests for router wrapper & backward compatibility
│       ├── provider.registry.test.js     # Unit tests for provider interface contract & registry
│       ├── openrouter.provider.test.js   # Unit tests for OpenRouter provider with mocked fetch & schemas
│       └── rateLimiter.test.js           # Unit tests for in-memory rate limiting and isolation
│
└── Frontend/
    ├── package.json                      # Frontend dependencies & scripts (test runs playwright test)
    ├── package-lock.json                 # Dependency lockfile
    ├── vite.config.js                    # Vite configuration
    ├── eslint.config.js                  # ESLint linting configuration
    ├── playwright.config.js              # Playwright E2E test runner configuration
    ├── vercel.json                       # Deployment routing configuration
    ├── index.html                        # HTML entry page
    ├── public/
    │   ├── favicon.svg                   # Browser tab icon
    │   └── icons.svg                     # SVG icon sprite bundle
    ├── tests/
    │   └── interview.spec.js             # Full Playwright test suite (10 scenarios: auth, AI, pagination, etc.)
    └── src/
        ├── App.jsx                       # Root React component providing Auth & Interview providers
        ├── main.jsx                      # React 19 DOM bootstrap mounting point
        ├── app.routes.jsx                # React Router definitions (public & protected routes)
        ├── style.scss                    # Global layout & utility styling
        ├── style/
        │   └── button.scss               # Reusable button styles & animations
        └── features/
            ├── auth/                     # Authentication Module
            │   ├── auth.context.jsx      # Auth state provider (user state, login, logout)
            │   ├── auth.form.scss        # Auth pages form styling
            │   ├── components/
            │   │   └── protected.jsx     # Route protection guard redirecting unauthorized users
            │   ├── hooks/
            │   │   └── useAuth.js        # Custom hook to consume AuthContext
            │   ├── pages/
            │   │   ├── Login.jsx         # Sign-in page
            │   │   └── Register.jsx      # Sign-up page
            │   └── services/
            │       └── auth.api.js       # Axios HTTP requests for auth endpoints
            │
            └── interview/                # Interview Preparation & Report Module
                ├── interview.context.jsx # Interview state provider (reports, pagination, active plan, loading)
                ├── hooks/
                │   └── useInterview.js   # Custom hook (generation, paginated retrieval, page changing)
                ├── pages/
                │   ├── Home.jsx          # Dashboard: input form, paginated recent plans list, and empty state
                │   └── Interview.jsx     # Detailed report: match score, questions, roadmap, PDF
                ├── services/
                │   └── interview.api.js  # Axios HTTP requests for interview plan endpoints
                └── style/
                    ├── Home.scss         # Styling for home dashboard, pagination controls, & empty state
                    └── Interview.scss    # Styling for interview details, tabs, and plan view
```

---

## 3. Detailed Component Breakdown

### 3.1 Backend (`Backend/`)

- **[server.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/server.js)**: Starts database connection and listens on `process.env.PORT || 3000`.
- **[src/app.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/app.js)**: Configures Express middleware (2MB body payload protection, cookie parsing, dynamic CORS headers) and mounts route handlers (`/api/auth`, `/api/interview`).
- **[src/config/database.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/config/database.js)**: Connects to MongoDB using `process.env.MONGO_URI`.

#### AI Gateway & Multi-Provider Layer (`src/services/ai/`)
- **[provider.interface.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/provider.interface.js)**:
  - Abstract base class defining the provider contract (`generateInterviewReport`, `generateResumePdf`, `isAvailable`, `model`).
- **[provider.registry.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/provider.registry.js)**:
  - Centralized Provider Registry containing default providers `gemini` and `openrouter`.
  - Exposes `registerProvider`, `getProvider`, `hasProvider`, `getRegisteredNames`, and `getAllProviders`.
- **[model.registry.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/model.registry.js)**:
  - Centralized Model Registry mapping individual models with assigned priorities, per-model timeouts, and designated final fallback status (`isFinalFallback`).
- **[model.health.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/model.health.js)**:
  - In-memory circuit breaker and health tracker per individual AI model. Tracks consecutive/total failures, success timestamps, latency, and enforces cooldown with probe recovery.
  - Extended with bounded rolling windows: `latencyHistory` (successful requests only, capped at 30) and `recentResults` (all outcomes, capped at 30), powering `getAverageLatencyMs()`, `getRecentSuccessRate()`, and `getObservationCount()` accessors used by `RoutingEngine`.
- **[routing.engine.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/routing.engine.js)**:
  - Dynamic, request-time model scoring and selection engine. Computes a composite weighted score per candidate: **45% recent success rate + 30% normalized latency + 20% circuit-breaker health + 5% availability**.
  - Applies cold-start defaults (`successRate=0.90`, `latencyScore=0.70`) for models with fewer than `MIN_OBSERVATIONS` (3) observations to avoid penalizing fresh models.
  - `selectBestModel()` filters eligible primaries (excluding `isFinalFallback`, already-attempted, and unhealthy models), scores all candidates, and returns the highest scorer with priority-based tie-breaking. `openrouter/free` is **never** scored by this engine.
- **[ai.gateway.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/ai.gateway.js)**:
  - Health-Aware Multi-Model AI Gateway executing tasks with strict timeouts, abort signal propagation, and loop-protected sequential fallback.
  - Uses `RoutingEngine.selectBestModel()` for dynamic request-time model selection across primary candidates; only engages `openrouter/free` final fallback after all primary models are exhausted or unhealthy.
  - Emits per-request routing score trace logs (`routingScore=[model:score(cs=bool)...]`) for full observability.
- **[ai.router.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/ai.router.js)**:
  - Model-aware router interface delegating execution directly to `aiGateway`.
- **[gemini.provider.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/gemini.provider.js)**:
  - Google Gemini integration using `@google/genai`. Configurable model via `GEMINI_MODEL` (default: `gemini-3-flash-preview`).
- **[openrouter.provider.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/openrouter.provider.js)**:
  - OpenRouter API integration using OpenAI-compatible completions with native `AbortController` cancellation and multi-format `extractAndParseJson` helper supporting raw JSON, Markdown code blocks, and responses embedded in conversational text.
- **[ai.service.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai.service.js)**:
  - Application-level boundary for AI operations dispatching calls to `aiGateway.execute()`.
  - Normalizes vendor errors into domain `AIError` instances.

#### Middlewares, Controllers, & Models
- **[src/middlewares/rateLimiter.middleware.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/middlewares/rateLimiter.middleware.js)**:
  - In-memory sliding window rate limiter keyed by user ID or IP (`AI_REQUEST_LIMIT_PER_WINDOW`, `AI_RATE_LIMIT_WINDOW_MS`).
- **[src/controllers/interview.controller.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/controllers/interview.controller.js)**:
  - Handles HTTP requests, calls `ai.service.js`, and maps `AIError` to clean HTTP status codes (429, 503, 504, 422, 500).
- **[src/models/interviewReport.model.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/models/interviewReport.model.js)**:
  - Stores interview plans and match scores; indexed on `{ user: 1, isStarred: -1, createdAt: -1 }`.

#### Backend Tests & Benchmarks (`tests/`, `scripts/`)
- **[benchmark-ai-latency.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/scripts/benchmark-ai-latency.js)**: Standalone benchmark script measuring real response latency, token throughput, and router decisions.
- **[model.routing.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/model.routing.test.js)**: Full 16+ scenario test suite verifying priority ordering, health cooldowns, probe recovery, timeout abortions, fallback loops, and openrouter/free behavior.
- **[ai.service.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/ai.service.test.js)**: Unit tests for domain error normalization and API key sanitization.
- **[ai.gateway.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/ai.gateway.test.js)**: Unit tests for AI Gateway dynamic provider selection, rate limit cooldowns, and fallback.
- **[routing.engine.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/routing.engine.test.js)**: 32 unit tests covering `normalizeLatency` boundary/interpolation, `scoreModel` (cold-start, measured values, clamping, health components, component breakdown), `selectBestModel` (filtering, tie-breaking, dynamic vs. static ordering), and AIGateway integration tests confirming engine-driven selection and final fallback behavior.
- **[ai.router.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/ai.router.test.js)**: Backward-compatibility unit tests for router routing and fallback logic.
- **[provider.registry.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/provider.registry.test.js)**: Unit tests for AIProvider abstract contract and ProviderRegistry lookup & registration.
- **[openrouter.provider.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/openrouter.provider.test.js)**: Unit tests for OpenRouter provider with multi-format JSON extraction and Zod output verification.
- **[rateLimiter.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/rateLimiter.test.js)**: Unit tests for in-memory rate limiting and isolation.

---

### 3.2 Frontend (`Frontend/`)

- **[src/main.jsx](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/main.jsx)** & **[src/App.jsx](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/App.jsx)**: Mounts React tree with Auth and Interview providers.
- **[src/features/interview/](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/features/interview)**:
  - `interview.context.jsx` & `useInterview.js`: Encapsulates generation, paginated fetching, and page state.
  - `Home.jsx`: Dashboard displaying input form, paginated recent plans list, and empty state indicator.
  - `Interview.jsx`: Detailed plan view with match score, accordion questions, preparation roadmap, and resume PDF download.
- **[tests/interview.spec.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/tests/interview.spec.js)**: 10 Playwright E2E test scenarios covering full user flows.

---

## 4. Environment Variables Reference

### Backend (`Backend/.env`)
| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Port for the backend Express server | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/interview-prep` |
| `JWT_SECRET` | Secret key used to sign and verify JSON Web Tokens | `your-secret-key` |
| `GOOGLE_GENAI_API_KEY` | Google Gemini API Key | `AIzaSy...` |
| `OPENROUTER_API_KEY` | OpenRouter API Key | `sk-or-v1-...` |
| `AI_ENABLE_FALLBACK` | Whether transient fallback is active (`true`/`false`) | `true` |
| `GEMINI_MODEL` | Gemini model name | `gemini-3-flash-preview` |
| `OPENROUTER_MODEL` | OpenRouter model name | `openrouter/free` |
| `FRONTEND_URL` | URL of the frontend for CORS configuration | `http://localhost:5173` |
| `AI_REQUEST_LIMIT_PER_WINDOW` | Maximum AI requests allowed per rate limit window | `10` |
| `AI_RATE_LIMIT_WINDOW_MS` | Duration of the sliding rate limit window in ms | `900000` (15 mins) |
| `AI_MAX_RETRIES` | Maximum retry attempts for transient AI errors | `2` |
| `AI_REQUEST_TIMEOUT_MS` | AI request timeout threshold in ms | `60000` (60 secs) |

---

## 5. How to Add a Future Provider

Adding a new provider (e.g. OpenAI, Anthropic Claude, DeepSeek) requires **zero changes to controllers, frontend code, or routing algorithms**:

1. **Create Provider Class**:
   - Create `Backend/src/services/ai/<provider-name>.provider.js`.
   - Extend `AIProvider` from `provider.interface.js`.
   - Implement `generateInterviewReport(data, options)` and `generateResumePdf(data, options)`.
   - Parse and validate output using `interviewReportSchema` and `resumePdfSchema`.
2. **Register in Provider Registry**:
   - In `Backend/src/services/ai/provider.registry.js`, import the provider and call:
     ```javascript
     this.registerProvider("<provider-name>", <providerInstance>);
     ```
   - The `RoutingEngine` and `AIGateway` will immediately and automatically evaluate the new provider at runtime based on its availability, health, latency, and success rates.
3. **Configure Environment Variables**:
   - Add `<PROVIDER>_API_KEY` and `<PROVIDER>_MODEL` to `.env`.
4. **Add Unit Tests**:
   - Create `Backend/tests/<provider-name>.provider.test.js` with mock requests verifying schema conformance.
5. **Update Routing**:
   - Switch `AI_DEFAULT_PROVIDER` or `AI_FALLBACK_PROVIDER` to the new provider when desired.
