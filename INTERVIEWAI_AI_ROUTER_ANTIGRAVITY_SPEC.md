# InterviewAI — Scaling Plan (Current Scope)

## 1. Objective

## 1.1 Mandatory Git Branching Rule

**NEVER make direct changes to the `main` branch.**

This is a strict and non-negotiable project requirement.

Before making **any** code, configuration, dependency, documentation, or structural change:

1. Ensure the current working branch is **not `main`**.
2. Create and switch to a dedicated feature/development branch before making changes.
3. All implementation work for this AI Router project must be performed on that branch.
4. Do not commit changes directly to `main`.
5. Do not push changes directly to `main`.
6. Do not merge into `main` automatically.
7. Do not modify `main` even for small fixes, documentation changes, dependency changes, or configuration changes.

### Recommended Branch

For this implementation, use:

```text
feature/ai-router
```

The expected workflow is:

```text
main
  |
  | create branch
  v
feature/ai-router
  |
  +-- implement changes
  +-- test changes
  +-- update PROJECT_STRUCTURE.md
  +-- review changes
  |
  v
Pull Request / Manual Merge
  |
  v
main
```

### Important

If the repository is currently on `main`, **do not begin implementation immediately**.

First create and switch to the feature branch:

```bash
git checkout -b feature/ai-router
```

or the equivalent Git command supported by the environment.

After implementation, leave the changes on the feature branch.

**Antigravity must not merge the branch into `main` unless the user explicitly requests the merge in a separate instruction.**

This rule applies throughout the entire implementation process.


This is the **initial scaling phase** for InterviewAI.

The goal is to improve the architecture without over-engineering the project. The existing project structure must remain intact and recognizable.

The following areas are intentionally **deferred to a later phase**:

- Multi-provider implementation / second-provider integration
- Automatic provider fallback
- Resume/object-storage migration
- AI job queues
- AI workers
- Redis
- Authentication architecture changes for distributed state
- Caching
- Advanced provider routing/load balancing

These can be introduced later when the application actually requires them.

---

# 2. Current Architecture

```text
                         React Frontend
                               |
                               v
                         Express API
                               |
                    +----------+----------+
                    |                     |
                    v                     v
              Auth Controllers     Interview Controller
                                          |
                                          v
                                   AI Service Layer
                                          |
                                          v
                                        Gemini
                                          |
                                          v
                                      MongoDB
```

The current application is a React 19/Vite frontend with a Node.js/Express backend, MongoDB/Mongoose, Google Gemini through `@google/genai`, Zod structured output, JWT authentication, Multer, and `pdf-parse`.

The backend already keeps the Gemini integration inside `src/services/ai.service.js`, while controllers handle the application flow.

---

# 3. Scope of This Phase

For now, focus on **four areas**:

1. Clean separation between the controller and AI implementation.
2. Make the existing Gemini integration easier to replace or extend later.
3. Add basic request protection and reliable error handling.
4. Improve MongoDB access with appropriate indexes and pagination where needed.

The application should continue using **Gemini as the only AI provider** in this phase.

There should be **no provider switching or fallback logic yet**.

---

# 4. Phase 1 — AI Service Abstraction

## Goal

Keep the controller independent from Gemini-specific implementation details.

Current:

```text
interview.controller.js
        |
        v
ai.service.js
        |
        v
Gemini
```

Keep this overall structure, but make `ai.service.js` the clear application-level boundary for AI operations.

The controller should call:

```javascript
aiService.generateInterviewReport(data)
```

and:

```javascript
aiService.generateResumePdf(data)
```

The controller should NOT directly import `@google/genai` or contain Gemini-specific code.

---

# 5. AI Service Responsibilities

Keep:

```text
Backend/src/services/ai.service.js
```

as the main AI service.

It should own:

- Gemini client initialization
- Gemini model configuration
- prompt construction
- Gemini request execution
- structured response handling
- Zod validation
- AI-specific error normalization

The controller should remain responsible for:

- receiving the HTTP request
- authentication context
- validating request-level input
- handling uploaded resume input
- calling the AI service
- storing the resulting report
- sending the HTTP response

This gives us a clean boundary for future provider expansion without implementing that expansion now.

---

# 6. Optional Internal Provider Boundary

If useful during implementation, Gemini-specific code can be moved into:

```text
Backend/
└── src/
    └── services/
        ├── ai.service.js
        └── ai/
            └── gemini.provider.js
```

The important rule is:

```text
Controller
    ↓
ai.service.js
    ↓
gemini.provider.js
    ↓
Gemini
```

This is an **internal abstraction only**.

Do not add Groq, OpenRouter, provider selection, provider health tracking, or fallback behavior in this phase.

The purpose is simply to make the future migration easier.

---

# 7. Keep Structured Output

InterviewAI currently relies on Zod and `zod-to-json-schema` for structured AI output.

Keep that design.

The generated interview report should continue to contain the existing application data:

```text
Match Score
Technical Questions
Behavioral Questions
Skill Gaps
Preparation Roadmap
```

The validation flow should remain:

```text
Gemini
   ↓
Structured Response
   ↓
Zod Validation
   ↓
Application Data
   ↓
MongoDB
```

Do not redesign the report schema as part of this phase.

---

# 8. Phase 2 — Request Protection

## Goal

Protect the existing API from accidental or abusive excessive requests.

The focus is only on **basic API protection**, not distributed rate limiting.

Apply reasonable request limits to expensive endpoints, especially:

```text
POST /api/interview/
POST /api/interview/resume/pdf/:interviewReportId
```

Also consider a general request-size limit.

The exact limits should be configurable through environment variables rather than hardcoded where practical.

Example:

```env
AI_REQUEST_LIMIT_PER_WINDOW=...
AI_RATE_LIMIT_WINDOW_MS=...
```

Do not build a Redis-based distributed rate limiter yet.

---

# 9. Phase 3 — Reliable AI Error Handling

The AI service should distinguish between different failure types.

Examples:

```text
Gemini rate limit
Gemini temporary server error
Gemini timeout/network error
Invalid AI response
Zod validation failure
Application/configuration error
```

The application should return safe, meaningful HTTP responses without exposing:

- API keys
- internal stack traces
- provider credentials
- unnecessary internal implementation details

---

# 10. Retry Policy

Use only a **small bounded retry mechanism** for transient AI failures.

Example concept:

```text
Gemini request
      |
      +-- success → return
      |
      +-- transient failure
              |
              v
           retry once/twice
              |
              +-- success → return
              |
              +-- failure → safe error
```

Do not implement:

- provider fallback
- multiple API providers
- complex provider routing
- infinite retries
- queue-based retries

Those are deliberately deferred.

---

# 11. Phase 4 — MongoDB Query Optimization

Keep MongoDB/Mongoose as the database.

Do not migrate databases.

Focus on the queries the current application already performs.

The dashboard retrieves interview reports belonging to the logged-in user, and reports are sorted by starred status and creation date.

Therefore, inspect the actual query patterns and add indexes that support them.

A likely index pattern is:

```javascript
{
    userId: 1,
    createdAt: -1
}
```

If the query sorts/filtering behavior requires a different compound index, use the index that matches the actual query.

Do not add unnecessary indexes.

---

# 12. Pagination

The current dashboard should not eventually load an unbounded number of reports.

Change the report-list API to support pagination when implementing this phase.

Conceptually:

```text
GET /api/interview?page=1&limit=20
```

Response:

```json
{
  "reports": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

The exact response shape should follow the existing frontend architecture and avoid breaking current behavior unnecessarily.

The full report endpoint should remain separate:

```text
GET /api/interview/report/:interviewId
```

This prevents the dashboard from loading the entire contents of every report.

---

# 13. MongoDB Connection Handling

Keep the existing centralized MongoDB connection in:

```text
Backend/src/config/database.js
```

Review the connection configuration for production suitability.

Do not introduce a second database layer.

Do not introduce Redis.

Do not introduce database sharding.

Those are unnecessary for the current stage.

---

# 14. Frontend Changes

Keep the existing frontend architecture.

Current relevant structure:

```text
Frontend/
└── src/
    └── features/
        └── interview/
            ├── interview.context.jsx
            ├── pages/
            │   ├── Home.jsx
            │   └── Interview.jsx
            └── services/
                └── interview.api.js
```

The frontend should remain unaware of Gemini implementation details.

Only update the frontend where required for:

- paginated report lists
- loading states
- rate-limit/error messages
- improved AI-generation error handling

Do not redesign the UI.

Do not introduce a new state-management framework.

---

# 15. Testing

Extend the existing tests without replacing the testing approach.

The current project uses Playwright for E2E testing.

Add coverage for:

```text
AI generation success
AI generation failure
AI validation failure
rate-limit response
report pagination
empty report list
report retrieval
existing star/delete behavior
```

AI provider tests should preferably mock the Gemini interaction instead of depending on a live API call.

This makes tests:

- faster
- deterministic
- cheaper
- less dependent on provider availability

---

# 16. Environment Configuration

Keep the existing variables:

```env
PORT=
MONGO_URI=
JWT_SECRET=
GOOGLE_GENAI_API_KEY=
FRONTEND_URL=
```

Only add configuration required by the features in this phase.

For example:

```env
AI_REQUEST_LIMIT_PER_WINDOW=
AI_RATE_LIMIT_WINDOW_MS=
AI_REQUEST_TIMEOUT_MS=
AI_MAX_RETRIES=
```

Do not add environment variables for providers that are not being implemented yet.

---

# 17. Target Structure for This Phase

The basic structure remains:

```text
Ai Powered Interview preparation/
│
├── .agents/
│   └── rules/
│       └── project-structure.md
│
├── AGENTS.md
├── PROJECT_STRUCTURE.md
│
├── Backend/
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   └── src/
│       ├── app.js
│       ├── config/
│       │   └── database.js
│       ├── controllers/
│       │   ├── auth.controller.js
│       │   └── interview.controller.js
│       ├── middlewares/
│       │   ├── auth.middleware.js
│       │   └── file.middleware.js
│       ├── models/
│       │   ├── blacklist.model.js
│       │   ├── interviewReport.model.js
│       │   └── user.model.js
│       ├── routes/
│       │   ├── auth.routes.js
│       │   └── interview.routes.js
│       └── services/
│           ├── ai.service.js
│           └── ai/
│               └── gemini.provider.js
│
└── Frontend/
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js
    ├── eslint.config.js
    ├── playwright.config.js
    ├── vercel.json
    ├── index.html
    ├── public/
    │   ├── favicon.svg
    │   └── icons.svg
    ├── tests/
    │   └── interview.spec.js
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── app.routes.jsx
        ├── style.scss
        ├── style/
        │   └── button.scss
        └── features/
            ├── auth/
            │   ├── auth.context.jsx
            │   ├── auth.form.scss
            │   ├── components/
            │   │   └── protected.jsx
            │   ├── hooks/
            │   │   └── useAuth.js
            │   ├── pages/
            │   │   ├── Login.jsx
            │   │   └── Register.jsx
            │   └── services/
            │       └── auth.api.js
            │
            └── interview/
                ├── interview.context.jsx
                ├── hooks/
                │   └── useInterview.js
                ├── pages/
                │   ├── Home.jsx
                │   └── Interview.jsx
                ├── services/
                │   └── interview.api.js
                └── style/
                    ├── Home.scss
                    └── Interview.scss
```

Only add the `ai/gemini.provider.js` file if the provider abstraction is actually implemented that way.

Do not add future-phase folders such as:

```text
queues/
workers/
```

in this phase.

---

# 18. Explicitly Deferred — Later Phase

The following should NOT be implemented now.

## Multi-provider AI

Later:

```text
AI Router
   ├── Gemini
   ├── Groq
   └── OpenRouter
```

For now:

```text
AI Service
    ↓
Gemini
```

## Provider fallback

Later:

```text
Gemini fails
    ↓
Groq
    ↓
OpenRouter
```

For now, return a controlled error after bounded retry.

## Object storage

Later:

```text
Browser
   ↓
S3/Object Storage
   ↓
PDF Worker
```

For now, preserve the current PDF upload architecture.

## Queue/workers

Later:

```text
API
 ↓
Queue
 ↓
AI Workers
```

For now, keep the current synchronous generation flow.

## Redis

Later:

```text
Redis
 ├── Queue
 ├── Cache
 ├── Rate limiting
 └── Shared transient state
```

For now, do not introduce Redis.

## Authentication changes

Later, if distributed infrastructure requires it, revisit shared transient authentication state.

For now, keep the current JWT + blacklist model.

## Caching

Later, introduce caching only after identifying actual expensive repeated operations.

For now, do not add a caching layer.

## Horizontal API scaling

Later:

```text
Load Balancer
   ├── API #1
   ├── API #2
   └── API #N
```

For now, optimize the existing backend first.

---

# 19. Implementation Order

Implement only the following sequence:

```text
1. Protect current AI service boundary
          ↓
2. Extract/organize Gemini-specific implementation
          ↓
3. Keep Zod structured output
          ↓
4. Add bounded transient-error retries
          ↓
5. Add API request/rate protection
          ↓
6. Optimize MongoDB indexes
          ↓
7. Add report pagination
          ↓
8. Improve error/loading handling
          ↓
9. Extend automated tests
          ↓
10. Update PROJECT_STRUCTURE.md
```

---

# 20. Definition of Done

This phase is complete when:

- Existing application functionality still works.
- Gemini remains the only AI provider.
- Controllers do not contain Gemini-specific implementation.
- AI functionality has a clean service boundary.
- Structured output continues to be validated through Zod.
- Transient Gemini failures have bounded retries.
- Expensive endpoints have basic request protection.
- MongoDB queries have appropriate indexes.
- Interview reports are paginated.
- Existing frontend structure remains intact.
- Existing authentication remains intact.
- Existing Playwright tests continue to pass.
- New tests cover the scaling changes.
- `PROJECT_STRUCTURE.md` accurately reflects every structural change.

---

# 21. Future Scaling Roadmap

After this phase is stable, future phases can be introduced independently:

```text
CURRENT PHASE
    |
    +-- AI Service abstraction
    +-- Gemini reliability
    +-- API protection
    +-- MongoDB optimization
    +-- Pagination
    |
    v
FUTURE PHASE
    |
    +-- Multiple AI providers
    +-- Provider routing
    +-- Automatic fallback
    |
    v
FUTURE PHASE
    |
    +-- Object storage
    +-- Queue
    +-- Workers
    |
    v
FUTURE PHASE
    |
    +-- Redis
    +-- Distributed rate limiting
    +-- Shared state
    |
    v
FUTURE PHASE
    |
    +-- Horizontal API scaling
    +-- Independent worker scaling
    +-- Advanced observability
```

The purpose of this staged approach is to **scale only what is needed now while keeping the architecture ready for the next level**.
