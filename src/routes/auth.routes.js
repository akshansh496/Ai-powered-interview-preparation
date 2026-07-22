const express=require("express")
const authController=require("../controllers/auth.controller")

const authRouter=express.Router()
/**
 * @route POST  /api/auth/register
 * @description Register a new User
 * @access Public
 */
authRouter.post("/register",authController.registerUserController)


/**
 * @route POST  /api/auth/login
 * @description Login User with email and password
 * @access Public
 */

authRouter.post("/login",authController.loginUserController)

module.exports=authRouter;