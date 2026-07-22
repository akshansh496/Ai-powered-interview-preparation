const jwt=require("jsonwebtoken")
const tokenBlackListModel=require("../models/blacklist.model")

async function authUser(req,res,next){
    const token=req.cookies.token

    if(!token){
        res.status(401).json({message:"Token not provided"})
    }

    const isTokenBlacklisted=await tokenBlackListModel.findOne({token}) 
    if(isTokenBlacklisted){
        res.status(401).json({message:"Token is invalid"})
    }
    try{
        const decoded=jwt.verify(token,process.env.JWT_SECRET)
        req.user=decoded
        next()
    }
    catch(err){
        res.status(401).json({message:"Invalid token"})
    }
    
}

module.exports={authUser}