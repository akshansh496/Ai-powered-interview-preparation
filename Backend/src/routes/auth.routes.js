const express=require("express")
const authController=require("../controllers/auth.controller")
const authMiddleware=require("../middlewares/auth.middleware")

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

/**
 * @route GET  /api/auth/logout
 * @description clear token from user cookie and add token to blacklist
 * @access Public
 */

authRouter.get("/logout",authController.logoutUserController)

/**
 * @route GET  /api/auth/get-me
 * @description get current logged in user details
 * @access Private
 */
authRouter.get("/me",authMiddleware.authUser,authController.getMeController)


module.exports=authRouter;