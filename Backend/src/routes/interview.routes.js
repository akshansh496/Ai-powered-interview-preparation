const express=require("express")
const authMiddleware=require("../middlewares/auth.middleware")
const interviewController=require("../controllers/interview.controller")
const upload=require("../middlewares/file.middleware")

const { aiEndpointRateLimiter } = require("../middlewares/rateLimiter.middleware")

const interviewRouter=express.Router()

/**
 * @route POST  /api/interview
 * @description Generate new Interview Report on the basis of user self description,resume pdf and job description
 * @access private
 */
interviewRouter.post("/", authMiddleware.authUser, aiEndpointRateLimiter, upload.single("resume"), interviewController.generateInterViewReportController)

/**
 * @route GET /api/interview/report/:interviewId
 * @description get interview report by interviewId
 * @access private
 */
interviewRouter.get("/report/:interviewId", authMiddleware.authUser, interviewController.getInterviewReportByIdController)

/**
 * @route GET /api/interview
 * @description get all interview reports of logged in user
 * @access private
 */
interviewRouter.get("/", authMiddleware.authUser, interviewController.getAllInterviewReportsController)

/**
 * @route POST /api/interview/resume/pdf/:interviewReportId
 * @description generate resume pdf on the basis of user self description, resume content and job description.
 * @access private
 */
interviewRouter.post("/resume/pdf/:interviewReportId", authMiddleware.authUser, aiEndpointRateLimiter, interviewController.generateResumePdfController)

/**
 * @route DELETE /api/interview/:interviewId
 * @description delete an interview report
 * @access private
 */
interviewRouter.delete("/:interviewId", authMiddleware.authUser, interviewController.deleteInterviewReportController)

/**
 * @route PATCH /api/interview/star/:interviewId
 * @description star/unstar an interview report
 * @access private
 */
interviewRouter.patch("/star/:interviewId", authMiddleware.authUser, interviewController.starInterviewReportController)

module.exports=interviewRouter