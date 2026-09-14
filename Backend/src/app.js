const express=require("express")
const cookieParser=require("cookie-parser")
const cors=require("cors")

const app=express()
// Limit JSON and URL-encoded body payloads to prevent abuse
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true, limit: "2mb" }))
app.use(cookieParser())
let frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
if (frontendUrl.endsWith("/")) {
    frontendUrl = frontendUrl.slice(0, -1);
}

app.use(cors({
    origin: frontendUrl,
    credentials: true
}))




//require all routes here
const authRouter=require("./routes/auth.routes")
const interviewRouter=require("./routes/interview.routes")

app.use("/api/auth",authRouter)//Whenever a request starts with /api/auth, pass it to authRouter
app.use("/api/interview",interviewRouter)


module.exports=app 