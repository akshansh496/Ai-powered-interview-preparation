import { createContext,useState } from "react";


export const InterviewContext = createContext()

export const InterviewProvider = ({ children }) => {
    const [loading, setLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState({ title: "", subtitle: "" })
    const [error, setError] = useState(null)
    const [report, setReport] = useState(null)
    const [reports, setReports] = useState([])
    const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 })

    return (
        <InterviewContext.Provider value={{ 
            loading, 
            setLoading, 
            loadingMessage, 
            setLoadingMessage, 
            error, 
            setError, 
            report, 
            setReport, 
            reports, 
            setReports,
            pagination,
            setPagination
        }}>
            {children}
        </InterviewContext.Provider>
    )
}