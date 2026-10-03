const express = require("express")
const cookieParser = require("cookie-parser")
const cors = require("cors")
const compression = require("compression")

const app = express()

// Compress all HTTP responses (gzip/deflate)
/**
 * Server se frontend ko bhejne wale response ko compress karta hai
 * Without compression:
 * Backend → 1 MB response → Frontend
 * 
 * With compression:
 * Backend → 300 KB compressed response → Frontend
 * 
 * Isase bandwidth kam use hota hai aur frontend jaldi load hota hai
 */
app.use(compression())
/**
 * JSON request bodies ko parse karta hai aur request payload ko maximum 2 MB tak limit karta hai.
 * 
 */
app.use(express.json({ limit: "2mb" }))
/**
 * URL-encoded data (form submissions) ko parse karta hai aur usko bhi 2 MB tak limit karta hai.
 * 
 */
app.use(express.urlencoded({ extended: true, limit: "2mb" }))

/**
 * Cookie-parser cookies ko parse karne ke liye
 * 
 */
app.use(cookieParser())
let frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173" || "http://localhost:4173" || "https://interview-ai-nu.vercel.app";
if (frontendUrl.endsWith("/")) {
    frontendUrl = frontendUrl.slice(0, -1);
}
const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:4173",
    "https://interview-ai-nu.vercel.app"
].filter(Boolean);


app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));




//require all routes here
const authRouter      = require("./routes/auth.routes")
const interviewRouter = require("./routes/interview.routes")

app.use("/api/auth",      authRouter)      // /api/auth/*
app.use("/api/interview", interviewRouter) // /api/interview/*
app.use("/api/ai",        interviewRouter) // /api/ai/models (model status endpoint)


module.exports = app 