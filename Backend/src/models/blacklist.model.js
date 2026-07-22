const mongoose=require('mongoose')
const cookieParser=require("cookie-parser")

const blackListTokenSchema=new mongoose.Schema({
    token:{
        type:String,
        required:[true,"Token is required to be in blacklist"]
    }
},{
    timestamps:true
})

const tokenBlackListModel=mongoose.model("blacklistToken",blackListTokenSchema)

module.exports=tokenBlackListModel
