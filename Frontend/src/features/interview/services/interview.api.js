import axios from "axios";

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
    withCredentials: true,
})

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token")
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
}, (error) => {
    return Promise.reject(error)
})


/**
 * @description Service to generate interview report based on user self description, resume and job description.
 * @param {string|null} requestedModel - null/"auto"/"gateway-auto" for dynamic routing; model id string for manual
 */
export const generateInterviewReport = async ({ jobDescription, selfDescription, resumeFile, daysUntilInterview, requestedModel }) => {

    const formData = new FormData()
    formData.append("jobDescription", jobDescription)
    formData.append("selfDescription", selfDescription)
    formData.append("resume", resumeFile)
    if (daysUntilInterview !== undefined && daysUntilInterview !== null && daysUntilInterview !== "") {
        formData.append("daysUntilInterview", daysUntilInterview)
    }
    // Manual model override — omit/null means Auto mode
    if (requestedModel && requestedModel !== "auto" && requestedModel !== "gateway-auto") {
        formData.append("requestedModel", requestedModel)
    }

    const response = await api.post("/api/interview/", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    })

    return response.data

}


/**
 * @description Fetch available AI models from the backend model registry.
 * Returns { models: [{ id, name, provider, available, healthy }] }
 */
export const getAvailableModels = async () => {
    const response = await api.get("/api/ai/models")
    return response.data
}



/**
 * @description Service to get interview report by interviewId.
 */
export const getInterviewReportById = async (interviewId) => {
    const response = await api.get(`/api/interview/report/${interviewId}`)

    return response.data
}


/**
 * @description Service to get all interview reports of logged in user with pagination.
 */
export const getAllInterviewReports = async (page, limit) => {
    const params = {}
    if (page !== undefined && page !== null) params.page = page
    if (limit !== undefined && limit !== null) params.limit = limit

    const response = await api.get("/api/interview/", Object.keys(params).length > 0 ? { params } : undefined)

    return response.data
}


/**
 * @description Service to generate resume pdf based on user self description, resume content and job description.
 */
export const generateResumePdf = async ({ interviewReportId }) => {
    const response = await api.post(`/api/interview/resume/pdf/${interviewReportId}`)

    return response.data
}

/**
 * @description Service to delete an interview report.
 */
export const deleteInterviewReport = async (interviewId) => {
    const response = await api.delete(`/api/interview/${interviewId}`)
    return response.data
}

/**
 * @description Service to star/unstar an interview report.
 */
export const toggleStarInterviewReport = async (interviewId, isStarred) => {
    const response = await api.patch(`/api/interview/star/${interviewId}`, { isStarred })
    return response.data
}