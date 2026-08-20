# InterviewAI

**AI-powered interview preparation platform** that analyzes your resume and a target job description to generate a personalized interview strategy — tailored questions, skill-gap analysis, an adaptive day-wise prep roadmap, and an AI-optimized resume rewrite.

🔗 **Live Demo:** [ai-powered-interview-preparation-56-gamma.vercel.app](https://ai-powered-interview-preparation-56-gamma.vercel.app/)

---

## ✨ Features

- **Match Score** — instantly see how well your profile fits a given job description
- **Personalized Technical & Behavioral Questions** — questions generated from your *actual* resume/projects, not generic interview banks
- **Intention + Model Answer** for every question — understand *why* interviewers ask it and how to structure a strong answer
- **Skill Gap Analysis** — missing or weak skills for the role, ranked by severity (low/medium/high)
- **Adaptive Preparation Roadmap** — a day-wise study plan that scales in length and depth to how many days you actually have before your interview (or a sensible 5–7 day default if you don't specify)
- **AI-Tailored Resume** — generates an ATS-friendly, job-specific resume rewrite as clean HTML, downloadable via the browser's print-to-PDF
- **Saved Plans Dashboard** — view, star, and delete previously generated interview plans
- **Secure Auth** — JWT-based authentication with HTTP-only cookies and token blacklisting on logout

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + Vite
- React Router
- Sass (SCSS)
- Axios

**Backend**
- Node.js + Express 5
- MongoDB + Mongoose
- Google Gemini API (`gemini-3-flash-preview`) via `@google/genai`
- Zod + `zod-to-json-schema` for strict, typed structured AI output
- JWT authentication (`jsonwebtoken`, `bcrypt`)
- `multer` for in-memory file uploads
- `pdf-parse` for resume text extraction

**Deployment**
- Frontend: Vercel
- Backend: Node/Express server (any Node host — Render, Railway, etc.)

---

## 🧠 How It Works

1. **Input** — user pastes a job description and either uploads a resume (PDF) or writes a quick self-description, optionally specifying how many days they have until their interview.
2. **Parsing** — the resume PDF is parsed server-side into plain text using `pdf-parse`.
3. **Structured AI Generation** — the resume text, self-description, job description, and timeline are sent to Gemini with a **Zod schema** (converted to JSON Schema) as the `responseSchema`. This forces Gemini to return strictly typed JSON — match score, question sets, skill gaps, and the preparation plan — with no manual text parsing needed.
4. **Adaptive Planning** — if a timeline is provided, the prompt instructs Gemini to generate exactly that many days in the roadmap, scaling workload realistically and prioritizing high-impact topics when the timeline is short.
5. **Resume Tailoring** — on request, a second Gemini call rewrites the candidate's resume as ATS-friendly HTML tailored to the job description, which the browser then renders and converts to PDF via `window.print()`.

---

## 📂 Project Structure

```
Ai-powered-interview-preparation/
├── Backend/
│   ├── server.js
│   └── src/
│       ├── app.js
│       ├── config/          # DB connection
│       ├── controllers/     # Route handlers
│       ├── middlewares/     # Auth + file upload
│       ├── models/          # Mongoose schemas
│       ├── routes/          # Express routers
│       └── services/        # Gemini AI service layer
└── Frontend/
    └── src/
        ├── features/
        │   ├── auth/         # Login/Register
        │   └── interview/    # Home, plan generator, report view
        └── style/
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (local or Atlas)
- A Google Gemini API key

### 1. Clone the repo
```bash
git clone https://github.com/akshansh496/Ai-powered-interview-preparation.git
cd Ai-powered-interview-preparation
```

### 2. Backend setup
```bash
cd Backend
npm install
```

Create a `.env` file in `Backend/`:
```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GOOGLE_GENAI_API_KEY=your_gemini_api_key
FRONTEND_URL=http://localhost:5173
```

Run the backend:
```bash
npm run dev
```

### 3. Frontend setup
```bash
cd ../Frontend
npm install
```

Create a `.env` file in `Frontend/` (optional — defaults to `http://localhost:3000`):
```env
VITE_API_BASE_URL=http://localhost:3000
```

Run the frontend:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 📡 API Overview

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Register a new user | Public |
| POST | `/api/auth/login` | Login with email/password | Public |
| GET | `/api/auth/logout` | Logout & blacklist token | Public |
| GET | `/api/auth/me` | Get current user | Private |
| POST | `/api/interview/` | Generate a new interview report | Private |
| GET | `/api/interview/` | Get all reports for the logged-in user | Private |
| GET | `/api/interview/report/:interviewId` | Get a specific report | Private |
| POST | `/api/interview/resume/pdf/:interviewReportId` | Generate tailored resume HTML | Private |
| PATCH | `/api/interview/star/:interviewId` | Star/unstar a report | Private |
| DELETE | `/api/interview/:interviewId` | Delete a report | Private |

---

## 🗺️ Roadmap / Known Limitations

- Resume upload currently supports **PDF only** (DOCX parsing not yet implemented)
- Resume "PDF" download relies on the browser's native print dialog rather than server-side PDF rendering

---

## 📄 License

ISC
