const userModel=require("../models/user.model")
const bycrypt=require("bcryptjs")
const jwt=require("jsonwebtoken")

const tokenBlackListModel=require("../models/blacklist.model")

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

    const newUser=await userModel.create({
        username,
        email,
        password:hash,
    })

    const token=jwt.sign(
        {id:newUser._id,username:newUser.username},
        process.env.JWT_SECRET,
        {expiresIn:"1d"}
    )
    res.cookie("token", token, {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        maxAge: 24 * 60 * 60 * 1000
    })

    res.status(201).json({
        message:"User registered successfully",
        user:{
            id:newUser._id,
            username:newUser.username,
            email:newUser.email,
        },
    })
}

/**
 * @name loginUserController
 * @description Login a user, expects email and password in the request body
 * @access Public
 */
async function loginUserController(req,res){
    const {email,password}=req.body

    const user=await userModel.findOne({email})

    if(!user){
        return res.status(400).json({message:"User not found"})
    }

    const isPasswordValid =await bycrypt.compare(password,user.password)

    if(!isPasswordValid){
        return res.status(400).json({message:"Incorrect password"})
    }

    const token=jwt.sign(
        {id:user._id,username:user.username},
        process.env.JWT_SECRET,
        {expiresIn:"1d"}
    )
    res.cookie("token", token, {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        maxAge: 24 * 60 * 60 * 1000
    })

    res.status(201).json({
        message:"User logged in successfully",
        user:{
            id:user._id,
            username:user.username,
            email:user.email,
        },
    })
}

/**
 * @name logoutUserController
 * @description clear token from user cookie and add token to blacklist
 * @access Public
 */
async function logoutUserController(req,res){
    const token=req.cookies.token

    if(token){
        await tokenBlackListModel.create({token})

        res.clearCookie("token", {
            httpOnly: true,
            sameSite: "none",
            secure: true
        })
        res.status(200).json({message:"User logged out successfully"})
    }
}

async function getMeController(req,res){
    
    const user=await userModel.findById(req.user.id)

    res.status(200).json({
        message:"User fetched successfully",
        user:{
            id:user._id,
            username:user.username,
            email:user.email,
        },
    })
}

module.exports={registerUserController,loginUserController,logoutUserController,getMeController}