const pdfParse=require("pdf-parse")
const {generateInterviewReport,generateResumePdf}=require("../services/ai.service")
const interviewReportModel=require("../models//interviewReport.model")



/**
 * @description Controller to generate interview report based on self description,resume and job description
 */

async function generateInterViewReportController(req,res){
    try {
        const resumeFile = req.file
        let resumeText = ""
        if (resumeFile) {
            const resumeContent = await (new pdfParse.PDFParse(Uint8Array.from(resumeFile.buffer))).getText()
            resumeText = resumeContent.text
        }
        const { selfDescription, jobDescription } = req.body

        if (!jobDescription) {
            return res.status(400).json({
                message: "Job description is required."
            })
        }

        if (!resumeText && (!selfDescription || !selfDescription.trim())) {
            return res.status(400).json({
                message: "Either a resume or self-description is required to generate a personalized plan."
            })
        }

        const interviewReportByAi = await generateInterviewReport({
            resume: resumeText,
            selfDescription,
            jobDescription
        })

        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeText,
            selfDescription,
            jobDescription,
            ...interviewReportByAi
        })

        res.status(201).json({
            message: "Interview Report generated successfully",
            interviewReport
        })
    } catch (error) {
        console.error("Error in generateInterViewReportController:", error)
        res.status(500).json({
            message: "Failed to generate interview report.",
            error: error.message
        })
    }
}

/**
 * @description Controller to get interview report by interview id
 */
async function getInterviewReportByIdController(req,res){
    const {interviewId}=req.params

    const interviewReport=await interviewReportModel.findOne({_id:interviewId,user:req.user.id})

    if(!interviewReport){
        return res.status(401).json({
            message:"Interview Report not found"
        })
    }

    return res.status(200).json({
        message:"Interview Report fetched successfully",
        interviewReport
    })
}

/**
 * @description Controller to get all interview reports of logged in user
 */
async function getAllInterviewReportsController(req,res){
    const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ isStarred: -1, createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan")

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    })
}

/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    try {
        const { interviewReportId } = req.params

        const interviewReport = await interviewReportModel.findById(interviewReportId)

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found."
            })
        }

        const { resume, jobDescription, selfDescription } = interviewReport

        const html = await generateResumePdf({ resume, jobDescription, selfDescription })

        res.status(200).json({
            html
        })
    } catch (error) {
        console.error("Error in generateResumePdfController:", error)
        res.status(500).json({
            message: "Failed to generate resume HTML.",
            error: error.message
        })
    }
}

/**
 * @description Controller to delete an interview report
 */
async function deleteInterviewReportController(req, res) {
    try {
        const { interviewId } = req.params
        const deleted = await interviewReportModel.findOneAndDelete({ _id: interviewId, user: req.user.id })
        if (!deleted) {
            return res.status(404).json({
                message: "Interview plan not found."
            })
        }
        res.status(200).json({
            message: "Interview plan deleted successfully."
        })
    } catch (error) {
        console.error("Error in deleteInterviewReportController:", error)
        res.status(500).json({
            message: "Failed to delete interview plan.",
            error: error.message
        })
    }
}

/**
 * @description Controller to toggle star status of an interview report
 */
async function starInterviewReportController(req, res) {
    try {
        const { interviewId } = req.params
        const { isStarred } = req.body

        const report = await interviewReportModel.findOneAndUpdate(
            { _id: interviewId, user: req.user.id },
            { isStarred: !!isStarred },
            { new: true }
        )

        if (!report) {
            return res.status(404).json({
                message: "Interview plan not found."
            })
        }

        res.status(200).json({
            message: isStarred ? "Interview plan starred successfully." : "Interview plan unstarred successfully.",
            interviewReport: report
        })
    } catch (error) {
        console.error("Error in starInterviewReportController:", error)
        res.status(500).json({
            message: "Failed to update star status.",
            error: error.message
        })
    }
}

module.exports={
    generateInterViewReportController,
    getInterviewReportByIdController,
    getAllInterviewReportsController,
    generateResumePdfController,
    deleteInterviewReportController,
    starInterviewReportController
}