const express=require("express")
const cookieParser=require("cookie-parser")

const app=express()


app.use(express.json())
//app.use(express.json()) tells Express to parse the JSON data sent by the client and store the resulting JavaScript object in req.body.

app.use(cookieParser())

const authRouter=require("./routes/auth.routes")

app.use("/api/auth",authRouter)//Whenever a request starts with /api/auth, pass it to authRouter

module.exports=app 