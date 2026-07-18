const userModel=require("../models/user.model")
const bycrypt=require("bcryptjs")
const jwt=require("jsonwebtoken")

/**
 * 
 * @name  registerUserController
 * @description Register a new user
 * @access Public
 */

async function registerUserController(req,res){
    const{username,email,password}=req.body
    if(!username || !email || !password){
        return res.status(400).json({message:"Please fill all the fields"})
    }
    const isUserAlreadyExists=await userModel.findOne({
        $or: [{username},{email}]
    }
    );
    if(isUserAlreadyExists){
        return res.status(400).json({message:"User already exists"})
    }

    const hash=await bycrypt.hash(password,10);

    const newUser=new userModel.create({
        username,
        email,
        password:hash,
    })

    const token=jwt.sign(
        {id:user._id,username:user.username},
        process.env.JWT_SECRET,
        {expiresIn:"1d"}
    )
    res.cookie("token",token,)

    res.status(201).json({
        message:"User registered successfully",
        user:{
            id:newUser._id,
            username:newUser.username,
            email:newUser.email,
        },
    })
}

module.exports={registerUserController}