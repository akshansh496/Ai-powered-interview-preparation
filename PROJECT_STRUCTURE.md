# Project Architecture & Directory Structure

> [!IMPORTANT]
> **Maintenance Rule:** Whenever files or folders are added, removed, moved, or renamed, or when major architectural patterns change, this document (`PROJECT_STRUCTURE.md`) **must be updated immediately** to reflect the current state of the codebase.

---

## 1. High-Level Architecture Overview

This repository is a full-stack, AI-powered interview preparation platform consisting of two main parts:
- **`Backend/`**: Node.js & Express REST API powered by MongoDB (Mongoose) and Google Gemini AI (`@google/genai`). Features an abstracted AI service layer with bounded exponential retries, in-memory sliding window rate limiting, compound index database optimization, paginated query handling, and safe error normalization.
- **`Frontend/`**: Modern React 19 single-page application built with Vite, React Router v7/8, Sass for modular styling, Context API for state management, paginated dashboard history, and Playwright for end-to-end testing.

```
Ai Powered Interview preparation/
├── Backend/                 # Express API server, Gemini AI integration, MongoDB models & tests
├── Frontend/                # React 19 + Vite client application & Playwright E2E tests
├── .agents/rules/           # Custom AI assistant instructions & rules
├── AGENTS.md                # Agent instruction file ensuring project structure sync
└── PROJECT_STRUCTURE.md     # Project directory tree & architectural documentation
```

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
│   │           └── gemini.provider.js    # Gemini SDK encapsulation, structured output, & bounded retry backoff
│   └── tests/
│       ├── ai.service.test.js            # Unit tests for error normalization & key sanitization
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
- **[src/services/ai/gemini.provider.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai/gemini.provider.js)**:
  - Encapsulates Gemini SDK (`@google/genai`), prompt creation, and Zod structured response schemas.
  - Implements bounded exponential backoff retries for transient errors (429, 503, network timeouts) using configurable `AI_MAX_RETRIES` and `AI_REQUEST_TIMEOUT_MS`.
- **[src/services/ai.service.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/services/ai.service.js)**:
  - Serves as the clean application boundary between controllers and AI models.
  - Defines `AIError` and `normalizeAIError` to map vendor errors to domain errors (`RATE_LIMIT_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `REQUEST_TIMEOUT`, `VALIDATION_ERROR`, `CONFIGURATION_ERROR`) without leaking sensitive credentials or raw stack traces.
- **[src/middlewares/rateLimiter.middleware.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/middlewares/rateLimiter.middleware.js)**:
  - In-memory sliding window rate limiter keyed by user ID or client IP.
  - Protects expensive AI endpoints (`POST /api/interview/` and `POST /api/interview/resume/pdf/:id`).
  - Configurable via `AI_REQUEST_LIMIT_PER_WINDOW` (default 10) and `AI_RATE_LIMIT_WINDOW_MS` (default 15m).
- **[src/controllers/interview.controller.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/controllers/interview.controller.js)**:
  - `generateInterViewReportController`: Parses uploaded PDF or text, calls `ai.service.js`, maps `AIError` to clean HTTP statuses (429, 503, 504, 422, 500), and persists report.
  - `getInterviewReportByIdController`: Returns full details of an interview report.
  - `getAllInterviewReportsController`: Fetches paginated reports for logged-in user (`page`, `limit`), sorted by starred status and creation date; returns `{ interviewReports, reports, pagination: { page, limit, total, totalPages } }`.
  - `generateResumePdfController`: Generates ATS resume HTML with `AIError` status mapping.
  - `deleteInterviewReportController` & `starInterviewReportController`: Report lifecycle actions.
- **[src/controllers/auth.controller.js](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/controllers/auth.controller.js)**:
  - User registration, login with JWT token set in HTTP-only cookie, logout via token blacklisting, and profile retrieval.
- **[src/models/](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/src/models)**:
  - `interviewReport.model.js`: Stores evaluation reports, match scores, questions, and roadmaps; indexed on `{ user: 1, isStarred: -1, createdAt: -1 }`.
  - `user.model.js`: User schema with encrypted password storage.
  - `blacklist.model.js`: Stores invalidated JWT tokens with TTL expiration.
- **[tests/](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Backend/tests)**:
  - `ai.service.test.js`: Native node unit tests for error normalization and secret sanitization.
  - `rateLimiter.test.js`: Unit tests for in-memory rate limiting and isolation.

---

### 3.2 Frontend (`Frontend/`)

- **[src/main.jsx](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/main.jsx)** & **[src/App.jsx](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/App.jsx)**:
  - Mounts React DOM with `AuthProvider` and `InterviewProvider` wrapping the `RouterProvider`.
- **[src/app.routes.jsx](file:///Users/akshanshgupta/Desktop/Ai%20Powered%20Interview%20preparation/Frontend/src/app.routes.jsx)**:
  - Defines routing table (`/login`, `/register`, `/`, `/interview/:interviewId`).
- **Feature Modules (`src/features/`)**:
  - **`auth/`**:
    - `auth.context.jsx`, `hooks/useAuth.js`, `pages/Login.jsx`, `pages/Register.jsx`, `services/auth.api.js`.
  - **`interview/`**:
    - `interview.context.jsx`: Global interview state with `reports`, `report`, and `pagination`.
    - `hooks/useInterview.js`: Encapsulates generation, paginated fetching (`getReports(page, limit)`), and page transitions (`changePage`).
    - `pages/Home.jsx`: Generation form, recent reports list with pagination controls, and empty state indicator.
    - `pages/Interview.jsx`: Match score, technical & behavioral questions, roadmap, and resume PDF download.
    - `services/interview.api.js`: Axios client calls supporting query parameters (`page`, `limit`).
- **Testing (`tests/`)**:
  - `interview.spec.js`: Playwright E2E test suite covering:
    1. Report generation success & redirection.
    2. Generation server error handling & recovery.
    3. Rate limit (429) error boundary display.
    4. AI validation (422) error boundary display.
    5. Plan details & resume download.
    6. Form authentication & credential errors.
    7. Input validation requirements (resume or description).
    8. Plan starring and deletion.
    9. Multi-page report list pagination navigation.
    10. Empty state presentation when 0 reports exist.

---

## 4. Environment Variables Reference

### Backend (`Backend/.env`)
| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Port for the backend Express server | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/interview-prep` |
| `JWT_SECRET` | Secret key used to sign and verify JSON Web Tokens | `your-secret-key` |
| `GOOGLE_GENAI_API_KEY` | Google Gemini API Key for AI report and resume generation | `AIzaSy...` |
| `FRONTEND_URL` | URL of the frontend for CORS configuration | `http://localhost:5173` |
| `AI_REQUEST_LIMIT_PER_WINDOW` | Maximum AI requests allowed per rate limit window | `10` |
| `AI_RATE_LIMIT_WINDOW_MS` | Duration of the sliding rate limit window in ms | `900000` (15 mins) |
| `AI_MAX_RETRIES` | Maximum retry attempts for transient AI errors | `2` |
| `AI_REQUEST_TIMEOUT_MS` | AI request timeout threshold in ms | `60000` (60 secs) |

---

## 5. Maintenance Protocol

Whenever files or folders are:
1. **Created** (e.g. new services, components, pages, utility files, or config files),
2. **Deleted or Deprecated**,
3. **Renamed or Relocated**,
4. **Architecturally Reorganized** (e.g. adding state stores, migration of frameworks),

You **must update this file (`PROJECT_STRUCTURE.md`)** to reflect the new tree structure, file links, and descriptions.
