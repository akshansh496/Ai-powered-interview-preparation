"use strict"
const express = require("express")
const authMiddleware = require("../middlewares/auth.middleware")
const interviewController = require("../controllers/interview.controller")
const upload = require("../middlewares/file.middleware")
const { aiEndpointRateLimiter } = require("../middlewares/rateLimiter.middleware")

const interviewRouter = express.Router()

/**
 * @route GET  /api/ai/models
 * @description Returns the list of available, healthy AI models for model-selector UI.
 *              Requires authentication so anonymous callers cannot enumerate models.
 * @access private
 */
interviewRouter.get("/models", authMiddleware.authUser, interviewController.getAvailableModelsController)

/**
 * @route POST  /api/interview
 * @description Generate new Interview Report.
 *              Optional body field: requestedModel (null/omit = auto; model-id string = manual)
 * @access private
 */
interviewRouter.post("/", authMiddleware.authUser, aiEndpointRateLimiter, upload.single("resume"), interviewController.generateInterViewReportController)

/**
 * @route GET /api/interview/report/:interviewId
 * @description Get interview report by interviewId
 * @access private
 */
interviewRouter.get("/report/:interviewId", authMiddleware.authUser, interviewController.getInterviewReportByIdController)

/**
 * @route GET /api/interview
 * @description Get all interview reports of logged in user
 * @access private
 */
interviewRouter.get("/", authMiddleware.authUser, interviewController.getAllInterviewReportsController)

/**
 * @route POST /api/interview/resume/pdf/:interviewReportId
 * @description Generate resume pdf
 * @access private
 */
interviewRouter.post("/resume/pdf/:interviewReportId", authMiddleware.authUser, aiEndpointRateLimiter, interviewController.generateResumePdfController)

/**
 * @route DELETE /api/interview/:interviewId
 * @description Delete an interview report
 * @access private
 */
interviewRouter.delete("/:interviewId", authMiddleware.authUser, interviewController.deleteInterviewReportController)

/**
 * @route PATCH /api/interview/star/:interviewId
 * @description Star/unstar an interview report
 * @access private
 */
interviewRouter.patch("/star/:interviewId", authMiddleware.authUser, interviewController.starInterviewReportController)

module.exports = interviewRouter