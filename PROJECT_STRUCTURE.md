# Project Architecture & Directory Structure

> [!IMPORTANT]
> **Maintenance Rule:** Whenever files or folders are added, removed, moved, or renamed, or when major architectural patterns change, this document (`PROJECT_STRUCTURE.md`) **must be updated immediately** to reflect the current state of the codebase.

---

## 1. High-Level Architecture Overview

This repository is a full-stack, AI-powered interview preparation platform with a **Multi-AI Provider Router** architecture supporting Google Gemini and xAI Grok:

```text
                              Client Request
                                    |
                                    v
                           Interview Controller
                                    |
                                    v
                               AI Service
                                    |
                                    v
                                AI Router
                                    |
                    +---------------+---------------+
                    |                               |
                    v                               v
             Gemini Provider                  Grok Provider
                    |                               |
                    v                               v
             Google Gemini                       xAI Grok
                    |                               |
                    +---------------+---------------+
                                    |
                                    v
                              Validated Result
                                    |
                                    v
                                 MongoDB
```

### Core Architectural Principles
1. **Provider-Agnostic Controllers**: Controllers interact only with `ai.service.js` and never know which provider or model handles the request.
2. **Centralized AI Router**: `ai.router.js` manages a provider registry, selects providers based on configuration (`AI_DEFAULT_PROVIDER`), and executes requests with controlled fallback to `AI_FALLBACK_PROVIDER` on transient infrastructure failures (HTTP 429, 503, timeouts).
3. **Common Provider Contract**: All AI providers implement `AIProvider` (`provider.interface.js`), enforcing uniform capabilities and validation against shared Zod schemas (`interviewReportSchema`, `resumePdfSchema`).
4. **Resilience & Protection**: In-memory sliding window rate limiting, bounded exponential retry backoff, request timeout guards, and sanitized error normalization (`AIError`) prevent credential leaks.

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
├── PROJECT_STRUCTURE.md                  # This file (Project tree & module documentation)
│
├── Backend/
│   ├── package.json                      # Backend dependencies & scripts (dev, test via native node runner)
│   ├── package-lock.json                 # Dependency lockfile
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
│   │           ├── ai.router.js          # Centralized AI router, provider registry, & controlled fallback
│   │           ├── gemini.provider.js    # Google Gemini provider implementation with bounded retries
│   │           └── grok.provider.js      # xAI Grok provider implementation with structured Zod output
│   └── tests/
│       ├── ai.service.test.js            # Unit tests for error normalization & key sanitization
│       ├── ai.router.test.js             # Unit tests for router registry, routing, and fallback
│       ├── grok.provider.test.js         # Unit tests for Grok provider with mocked fetch & schemas
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
                │   ├── Home.jsx          # Dashboard: input form, paginated reports, empty state
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

#### AI Service & Multi-Provider Layer (`src/services/ai/`)
- **[provider.interface.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/provider.interface.js)**:
  - Abstract base class defining the provider contract (`generateInterviewReport`, `generateResumePdf`, `isAvailable`, `model`).
- **[ai.router.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/ai.router.js)**:
  - Centralized Provider Registry containing `gemini` and `grok`.
  - Routes tasks based on `AI_DEFAULT_PROVIDER` with optional request-level overrides.
  - Implements bounded fallback to `AI_FALLBACK_PROVIDER` on transient provider failures (HTTP 429, 503, network timeouts). Prevents fallback loops and rejects fallback for client validation/configuration errors.
  - Emits lightweight structured execution logs (task, provider, model, success/failure, latency, error category).
- **[gemini.provider.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/gemini.provider.js)**:
  - Google Gemini integration using `@google/genai`. Configurable model via `GEMINI_MODEL` (default: `gemini-3-flash-preview`).
  - Implements bounded exponential backoff retries and structured Zod schema output.
- **[grok.provider.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/grok.provider.js)**:
  - xAI Grok API integration using standard OpenAI-compatible REST endpoint (`https://api.x.ai/v1/chat/completions`) and native `fetch`.
  - Configurable model via `GROK_MODEL` (default: `grok-2-latest`) and API key via `XAI_API_KEY`.
  - Parses and validates structured responses against the shared `interviewReportSchema` and `resumePdfSchema`.
- **[ai.service.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai.service.js)**:
  - Application-level boundary for AI operations.
  - Dispatches calls to `aiRouter.route()`.
  - Normalizes vendor errors into domain `AIError` instances (`RATE_LIMIT_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `REQUEST_TIMEOUT`, `VALIDATION_ERROR`, `CONFIGURATION_ERROR`) without leaking sensitive credentials or stack traces.

#### Middlewares, Controllers, & Models
- **[src/middlewares/rateLimiter.middleware.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/middlewares/rateLimiter.middleware.js)**:
  - In-memory sliding window rate limiter keyed by user ID or IP (`AI_REQUEST_LIMIT_PER_WINDOW`, `AI_RATE_LIMIT_WINDOW_MS`).
- **[src/controllers/interview.controller.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/controllers/interview.controller.js)**:
  - Handles HTTP requests, calls `ai.service.js`, and maps `AIError` to clean HTTP status codes (429, 503, 504, 422, 500).
  - Supports paginated report retrieval (`page`, `limit`) returning `{ interviewReports, reports, pagination: { page, limit, total, totalPages } }`.
- **[src/models/interviewReport.model.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/models/interviewReport.model.js)**:
  - Stores interview plans and match scores; indexed on `{ user: 1, isStarred: -1, createdAt: -1 }`.

#### Backend Tests (`tests/`)
- **[ai.service.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/ai.service.test.js)**: Unit tests for domain error normalization and API key sanitization.
- **[ai.router.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/ai.router.test.js)**: Unit tests for provider registration, routing overrides, transient error fallback, and fallback loop prevention.
- **[grok.provider.test.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests/grok.provider.test.js)**: Unit tests for xAI Grok provider with mocked fetch, credential validation, and Zod output verification.
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
| `XAI_API_KEY` | xAI Grok API Key | `xai-...` |
| `AI_DEFAULT_PROVIDER` | Primary AI provider identifier | `gemini` |
| `AI_FALLBACK_PROVIDER` | Fallback AI provider identifier | `grok` |
| `AI_ENABLE_FALLBACK` | Whether transient fallback is active (`true`/`false`) | `true` |
| `GEMINI_MODEL` | Gemini model name | `gemini-3-flash-preview` |
| `GROK_MODEL` | xAI Grok model name | `grok-2-latest` |
| `FRONTEND_URL` | URL of the frontend for CORS configuration | `http://localhost:5173` |
| `AI_REQUEST_LIMIT_PER_WINDOW` | Maximum AI requests allowed per rate limit window | `10` |
| `AI_RATE_LIMIT_WINDOW_MS` | Duration of the sliding rate limit window in ms | `900000` (15 mins) |
| `AI_MAX_RETRIES` | Maximum retry attempts for transient AI errors | `2` |
| `AI_REQUEST_TIMEOUT_MS` | AI request timeout threshold in ms | `60000` (60 secs) |

---

## 5. How to Add a Future Provider

Adding a new provider (e.g. OpenAI, Anthropic Claude, DeepSeek, or OpenRouter) requires **zero changes to controllers or frontend code**:

1. **Create Provider Class**:
   - Create `Backend/src/services/ai/<provider-name>.provider.js`.
   - Extend `AIProvider` from `provider.interface.js`.
   - Implement `generateInterviewReport(data, options)` and `generateResumePdf(data, options)`.
   - Parse and validate output using `interviewReportSchema` and `resumePdfSchema`.
2. **Register in AI Router**:
   - In `Backend/src/services/ai/ai.router.js`, import the provider and call:
     ```javascript
     this.registerProvider("<provider-name>", <providerInstance>);
     ```
3. **Configure Environment Variables**:
   - Add `<PROVIDER>_API_KEY` and `<PROVIDER>_MODEL` to `.env`.
4. **Add Unit Tests**:
   - Create `Backend/tests/<provider-name>.provider.test.js` with mock requests verifying schema conformance.
5. **Update Routing**:
   - Switch `AI_DEFAULT_PROVIDER` or `AI_FALLBACK_PROVIDER` to the new provider when desired.
