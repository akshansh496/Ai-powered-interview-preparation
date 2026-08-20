import { getAllInterviewReports, generateInterviewReport, getInterviewReportById, generateResumePdf, deleteInterviewReport, toggleStarInterviewReport } from "../services/interview.api"
import { useContext, useEffect } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const { 
        loading, 
        setLoading, 
        loadingMessage, 
        setLoadingMessage, 
        error, 
        setError, 
        report, 
        setReport, 
        reports, 
        setReports 
    } = context

    const generateReport = async ({ jobDescription, selfDescription, resumeFile, daysUntilInterview }) => {
        setError(null)
        setLoading(true)
        setLoadingMessage({
            title: "Generating Strategy",
            subtitle: "Analyzing job description and preparing your custom questions..."
        })
        let response = null
        try {
            response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile, daysUntilInterview })
            if (response && response.interviewReport) {
                setReport(response.interviewReport)
            } else {
                throw new Error("Empty report response from server.")
            }
        } catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to generate interview strategy."
            setError(errMsg)
            throw err
        } finally {
            setLoading(false)
        }

        return response?.interviewReport
    }

    const getReportById = async (interviewId) => {
        setError(null)
        setLoading(true)
        setLoadingMessage({
            title: "Retrieving Report",
            subtitle: "Fetching your personalized preparation roadmap..."
        })
        let response = null
        try {
            response = await getInterviewReportById(interviewId)
            if (response && response.interviewReport) {
                setReport(response.interviewReport)
            } else {
                throw new Error("Report not found.")
            }
        } catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to retrieve interview report."
            setError(errMsg)
        } finally {
            setLoading(false)
        }
        return response?.interviewReport
    }

    const getReports = async () => {
        setError(null)
        setLoading(true)
        setLoadingMessage({
            title: "Loading Dashboard",
            subtitle: "Retrieving your recent interview preparation plans..."
        })
        let response = null
        try {
            response = await getAllInterviewReports()
            setReports(response.interviewReports || [])
        } catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to fetch interview plans."
            setError(errMsg)
        } finally {
            setLoading(false)
        }

        return response?.interviewReports
    }

    const getResumePdf = async (interviewReportId) => {
        setError(null)
        setLoading(true)
        setLoadingMessage({
            title: "Preparing Resume",
            subtitle: "Formatting and compiling your customized resume PDF..."
        })
        try {
            const data = await generateResumePdf({ interviewReportId })
            if (data && data.html) {
                const printWindow = window.open("", "_blank")
                if (printWindow) {
                    printWindow.document.write(data.html)
                    printWindow.document.title = `Resume_${interviewReportId}`
                    printWindow.document.close()
                    printWindow.focus()
                    printWindow.print()
                } else {
                    alert("Please allow popups to print/download your resume.")
                }
            } else {
                throw new Error("Empty resume response from server.")
            }
        }
        catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to generate resume."
            setError(errMsg)
        } finally {
            setLoading(false)
        }
    }

    const deleteReport = async (interviewId) => {
        setError(null)
        setLoading(true)
        setLoadingMessage({
            title: "Deleting Plan",
            subtitle: "Removing interview preparation plan from dashboard..."
        })
        try {
            await deleteInterviewReport(interviewId)
            setReports(prev => prev.filter(r => r._id !== interviewId))
        } catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to delete plan."
            setError(errMsg)
        } finally {
            setLoading(false)
        }
    }

    const toggleStar = async (interviewId, currentStarred) => {
        setError(null)
        try {
            const nextStarred = !currentStarred
            await toggleStarInterviewReport(interviewId, nextStarred)
            setReports(prev => {
                const updated = prev.map(r => r._id === interviewId ? { ...r, isStarred: nextStarred } : r)
                return updated.sort((a, b) => {
                    if (a.isStarred && !b.isStarred) return -1
                    if (!a.isStarred && b.isStarred) return 1
                    return new Date(b.createdAt) - new Date(a.createdAt)
                })
            })
            setReport(prev => {
                if (prev && prev._id === interviewId) {
                    return { ...prev, isStarred: nextStarred }
                }
                return prev
            })
        } catch (err) {
            console.error(err)
            const errMsg = err.response?.data?.message || err.message || "Failed to toggle star status."
            setError(errMsg)
        }
    }

    useEffect(() => {
        if (interviewId) {
            getReportById(interviewId)
        } else {
            getReports()
        }
    }, [ interviewId ])

    return { 
        loading, 
        loadingMessage, 
        error, 
        setError, 
        report, 
        reports, 
        generateReport, 
        getReportById, 
        getReports, 
        getResumePdf,
        deleteReport,
        toggleStar
    }

}