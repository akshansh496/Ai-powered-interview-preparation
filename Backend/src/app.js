const express=require("express")
const cookieParser=require("cookie-parser")
const cors=require("cors")

const app=express()
//app.use(express.json()) tells Express to parse the JSON data sent by the client and store the resulting JavaScript object in req.body.
app.use(express.json())
app.use(cookieParser())
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
}))




//require all routes here
const authRouter=require("./routes/auth.routes")
const interviewRouter=require("./routes/interview.routes")

app.use("/api/auth",authRouter)//Whenever a request starts with /api/auth, pass it to authRouter
app.use("/api/interview",interviewRouter)


module.exports=app 