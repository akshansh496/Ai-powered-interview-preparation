import React, { useState, useRef, useEffect } from 'react'
import "../style/Home.scss"
import { useInterview } from '../hooks/useInterview.js'
import { useNavigate } from 'react-router-dom'
import { useAuth } from "../../auth/hooks/useAuth"

// ── Model Selector Sub-component ─────────────────────────────────────────────
const ModelSelector = ({ models, selectedModelId, onSelect }) => {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    const selected = models.find(m => m.id === selectedModelId) || models[0]

    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [])

    if (!models || models.length === 0) return null

    const isAuto = selectedModelId === "gateway-auto" || !selectedModelId

    return (
        <div className='model-selector' ref={ref}>
            <div
                className={`model-selector__trigger ${open ? 'model-selector__trigger--open' : ''}`}
                onClick={() => setOpen(o => !o)}
                role="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                id="model-selector-trigger"
            >
                <span className='model-selector__icon'>
                    {isAuto ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    )}
                </span>
                <span className='model-selector__label'>{selected?.name || "Auto — Let Gateway Decide"}</span>
                {selected && !isAuto && (
                    <span className={`model-selector__status ${selected.healthy ? 'available' : 'unavailable'}`}>
                        {selected.healthy ? '✓' : '⚠'}
                    </span>
                )}
                <svg className='model-selector__chevron' xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>

            {open && (
                <div className='model-selector__dropdown' role="listbox">
                    {models.map(model => (
                        <div
                            key={model.id}
                            className={`model-selector__option ${model.id === selectedModelId ? 'model-selector__option--selected' : ''} ${!model.healthy ? 'model-selector__option--unhealthy' : ''}`}
                            onClick={() => { onSelect(model.id); setOpen(false) }}
                            role="option"
                            aria-selected={model.id === selectedModelId}
                        >
                            <div className='model-selector__option-info'>
                                <span className='model-selector__option-name'>{model.name}</span>
                                {model.provider && (
                                    <span className='model-selector__option-provider'>{model.provider}</span>
                                )}
                            </div>
                            <div className='model-selector__option-right'>
                                {!model.healthy && (
                                    <span className='model-selector__option-badge unavailable'>Unavailable</span>
                                )}
                                {model.id === selectedModelId && (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <p className='model-selector__hint'>
                {isAuto
                    ? "The Gateway automatically selects the best available model based on real-time health, latency and reliability."
                    : "Using selected model directly. Gateway fallback is disabled in manual mode."}
            </p>
        </div>
    )
}

// ── MODEL_UNAVAILABLE Error Banner ────────────────────────────────────────────
const ModelUnavailableBanner = ({ error, onChooseAnother, onSwitchToAuto }) => (
    <div className='model-unavailable-banner'>
        <div className='model-unavailable-banner__icon'>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div className='model-unavailable-banner__body'>
            <p className='model-unavailable-banner__title'>Model Unavailable</p>
            <p className='model-unavailable-banner__message'>{error.message}</p>
            <p className='model-unavailable-banner__sub'>Please choose another model or let the Gateway automatically select an available model.</p>
        </div>
        <div className='model-unavailable-banner__actions'>
            <button className='banner-btn banner-btn--secondary' onClick={onChooseAnother}>
                Choose another model
            </button>
            <button className='banner-btn banner-btn--primary' onClick={onSwitchToAuto}>
                Switch to Auto
            </button>
        </div>
    </div>
)

// ── Main Home Component ───────────────────────────────────────────────────────
const Home = () => {

    const {
        loading, loadingMessage, error, setError,
        generateReport, getReports, reports, pagination, changePage, deleteReport, toggleStar,
        selectedModelId, setSelectedModelId,
        availableModels, fetchAvailableModels,
        modelUnavailableError, setModelUnavailableError,
        aiMetadata
    } = useInterview()
    const { user, handleLogout } = useAuth()
    const [jobDescription, setJobDescription]     = useState("")
    const [selfDescription, setSelfDescription]   = useState("")
    const [daysUntilInterview, setDaysUntilInterview] = useState("")
    const [selectedFile, setSelectedFile]         = useState(null)
    const resumeInputRef = useRef()

    const navigate = useNavigate()

    useEffect(() => {
        getReports()
        fetchAvailableModels()
    }, [])

    const handleGenerateReport = async () => {
        if (!selectedFile && !selfDescription.trim()) {
            setError("A resume file or a quick self-description is required to generate a personalized plan.")
            return
        }
        if (!jobDescription.trim()) {
            setError("Job description is required.")
            return
        }
        const resumeFile = selectedFile
        try {
            const data = await generateReport({ jobDescription, selfDescription, resumeFile, daysUntilInterview })
            if (data && data._id) {
                navigate(`/interview/${data._id}`)
            }
        } catch (err) {
            // MODEL_UNAVAILABLE is handled by modelUnavailableError — no generic error set
            console.error("Report generation failed:", err.code || err.message)
        }
    }

    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (confirm("Are you sure you want to delete this interview plan?")) {
            deleteReport(id)
        }
    }

    const handleStarToggle = (e, id, isStarred) => {
        e.stopPropagation()
        toggleStar(id, isStarred)
    }

    const handleRemoveFile = (e) => {
        e.preventDefault()
        setSelectedFile(null)
        if (resumeInputRef.current) {
            resumeInputRef.current.value = ""
        }
    }

    if (error) {
        return (
            <main className='error-screen'>
                <div className='error-container'>
                    <div className='error-icon-container'>
                        <svg className='error-icon' xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </div>
                    <div className='error-text'>
                        <h2>Something Went Wrong</h2>
                        <p>{error}</p>
                    </div>
                    <div className='error-actions'>
                        <button className='button primary-button' onClick={() => setError(null)}>
                            Try Again
                        </button>
                    </div>
                </div>
            </main>
        )
    }

    if (loading) {
        return (
            <main className='loading-screen'>
                <div className='loading-container'>
                    <div className='loader-orb'>
                        <div className='orb-glow'></div>
                        <div className='orb-outer'></div>
                        <div className='orb-inner'></div>
                        <div className='orb-core'></div>
                    </div>
                    <div className='loading-text'>
                        <h2>{loadingMessage?.title || "Analyzing & Planning"}</h2>
                        {loadingMessage?.subtitle && <p>{loadingMessage.subtitle}</p>}
                    </div>
                    <div className='loading-progress-bar'>
                        <div className='progress-fill'></div>
                    </div>
                </div>
            </main>
        )
    }

    return (
        <div className='home-page'>

            {/* Top Navbar */}
            <nav className='app-navbar'>
                <div className='navbar-brand'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="brand-icon"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    <span>InterviewAI</span>
                </div>
                <div className='navbar-user'>
                    <span className='user-name'>{user?.username || user?.email || 'Candidate'}</span>
                    <button className='logout-btn' onClick={handleLogout}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                        Logout
                    </button>
                </div>
            </nav>

            {/* Page Header */}
            <header className='page-header'>
                <h1>Create Your Custom <span className='highlight'>Interview Plan</span></h1>
                <p>Let our AI analyze the job requirements and your unique profile to build a winning strategy.</p>
            </header>

            {/* MODEL_UNAVAILABLE banner */}
            {modelUnavailableError && (
                <ModelUnavailableBanner
                    error={modelUnavailableError}
                    onChooseAnother={() => setModelUnavailableError(null)}
                    onSwitchToAuto={() => {
                        setSelectedModelId("gateway-auto")
                        setModelUnavailableError(null)
                    }}
                />
            )}

            {/* Main Card */}
            <div className='interview-card'>
                <div className='interview-card__body'>

                    {/* Left Panel - Job Description */}
                    <div className='panel panel--left'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                            </span>
                            <h2>Target Job Description</h2>
                            <span className='badge badge--required'>Required</span>
                        </div>
                        <textarea
                            onChange={(e) => { setJobDescription(e.target.value) }}
                            className='panel__textarea'
                            placeholder={`Paste the full job description here...\ne.g. 'Senior Frontend Engineer at Google requires proficiency in React, TypeScript, and large-scale system design...'`}
                            maxLength={5000}
                        />
                        <div className='char-counter'>5000 chars</div>
                    </div>

                    {/* Vertical Divider */}
                    <div className='panel-divider' />

                    {/* Right Panel - Profile */}
                    <div className='panel panel--right'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            </span>
                            <h2>Your Profile</h2>
                        </div>

                        {/* Upload Resume */}
                        <div className='upload-section'>
                            <label className='section-label'>
                                Upload Resume
                                <span className='badge badge--best'>Best Results</span>
                            </label>
                            {selectedFile ? (
                                <div className='file-uploaded-status'>
                                    <div className='file-uploaded-status__info'>
                                        <div className='file-uploaded-status__icon'>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        </div>
                                        <div className='file-uploaded-status__details'>
                                            <p className='file-uploaded-status__name'>{selectedFile.name}</p>
                                            <p className='file-uploaded-status__size'>{(selectedFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <div className='file-uploaded-status__actions'>
                                        <span className='file-uploaded-status__badge'>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "2px"}}><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Attached
                                        </span>
                                        <button className='file-uploaded-status__remove' onClick={handleRemoveFile}>
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <label className='dropzone' htmlFor='resume'>
                                    <span className='dropzone__icon'>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>
                                    </span>
                                    <p className='dropzone__title'>Click to upload or drag &amp; drop</p>
                                    <p className='dropzone__subtitle'>PDF (Max 3MB)</p>
                                </label>
                            )}
                            <input ref={resumeInputRef} hidden type='file' id='resume' name='resume' accept='.pdf,.docx' onChange={(e) => { if (e.target.files[0]) setSelectedFile(e.target.files[0]) }} />
                        </div>

                        {/* OR Divider */}
                        <div className='or-divider'><span>OR</span></div>

                        {/* Quick Self-Description */}
                        <div className='self-description'>
                            <label className='section-label' htmlFor='selfDescription'>Quick Self-Description</label>
                            <textarea
                                onChange={(e) => { setSelfDescription(e.target.value) }}
                                id='selfDescription'
                                name='selfDescription'
                                className='panel__textarea panel__textarea--short'
                                placeholder="Briefly describe your experience, key skills, and years of experience if you don't have a resume handy..."
                            />
                        </div>

                        {/* Days Until Interview */}
                        <div className='days-input-section'>
                            <label className='section-label' htmlFor='daysUntilInterview'>Days Until Interview (Optional)</label>
                            <input
                                type='number'
                                min='1'
                                max='30'
                                value={daysUntilInterview}
                                onChange={(e) => { setDaysUntilInterview(e.target.value) }}
                                id='daysUntilInterview'
                                name='daysUntilInterview'
                                className='panel__input'
                                placeholder="e.g. 5 (Leave blank for default plan)"
                            />
                        </div>

                        {/* Info Box */}
                        <div className='info-box'>
                            <span className='info-box__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" stroke="#1a1f27" strokeWidth="2" /><line x1="12" y1="16" x2="12.01" y2="16" stroke="#1a1f27" strokeWidth="2" /></svg>
                            </span>
                            <p>Either a <strong>Resume</strong> or a <strong>Self Description</strong> is required to generate a personalized plan.</p>
                        </div>
                    </div>
                </div>

                {/* AI Model Selector */}
                <div className='interview-card__model-selector'>
                    <div className='model-selector-label'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                        AI Model
                    </div>
                    <ModelSelector
                        models={availableModels.length > 0
                            ? availableModels
                            : [{ id: "gateway-auto", name: "Auto — Let Gateway Decide", provider: null, available: true, healthy: true }]
                        }
                        selectedModelId={selectedModelId}
                        onSelect={setSelectedModelId}
                    />
                </div>

                {/* Card Footer */}
                <div className='interview-card__footer'>
                    <span className='footer-info'>AI-Powered Strategy Generation &bull; Approx 30s</span>
                    <button
                        onClick={handleGenerateReport}
                        className='generate-btn'
                        id='generate-strategy-btn'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                        Generate My Interview Strategy
                    </button>
                </div>
            </div>

            {/* Recent Reports List */}
            {reports.length > 0 ? (
                <section className='recent-reports'>
                    <h2>My Recent Interview Plans</h2>
                    <ul className='reports-list'>
                        {reports.map(report => (
                            <li key={report._id} className='report-item' onClick={() => navigate(`/interview/${report._id}`)}>
                                <div className='report-item__actions'>
                                    <button
                                        className={`star-btn ${report.isStarred ? 'star-btn--active' : ''}`}
                                        onClick={(e) => handleStarToggle(e, report._id, report.isStarred)}
                                        title={report.isStarred ? 'Unstar plan' : 'Star plan'}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={report.isStarred ? '#EAB308' : 'none'} stroke={report.isStarred ? '#EAB308' : 'currentColor'} strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                    </button>
                                    <button
                                        className='delete-btn'
                                        onClick={(e) => handleDelete(e, report._id)}
                                        title='Delete plan'
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                </div>
                                <h3>{report.title || 'Untitled Position'}</h3>
                                <p className='report-meta'>Generated on {new Date(report.createdAt).toLocaleDateString()}</p>
                                <p className={`match-score ${report.matchScore >= 80 ? 'score--high' : report.matchScore >= 60 ? 'score--mid' : 'score--low'}`}>Match Score: {report.matchScore}%</p>
                            </li>
                        ))}
                    </ul>

                    {/* Pagination Controls */}
                    {pagination && pagination.totalPages > 1 && (
                        <div className='reports-pagination'>
                            <button
                                className='pagination-btn'
                                disabled={pagination.page <= 1}
                                onClick={() => changePage(pagination.page - 1)}
                                aria-label='Previous Page'
                            >
                                &larr; Previous
                            </button>
                            <span className='pagination-info'>
                                Page {pagination.page} of {pagination.totalPages}
                            </span>
                            <button
                                className='pagination-btn'
                                disabled={pagination.page >= pagination.totalPages}
                                onClick={() => changePage(pagination.page + 1)}
                                aria-label='Next Page'
                            >
                                Next &rarr;
                            </button>
                        </div>
                    )}
                </section>
            ) : (
                <div className='empty-reports-state'>
                    <p>No saved interview plans yet. Generate your personalized strategy above to get started!</p>
                </div>
            )}

            {/* Page Footer */}
            <footer className='page-footer'>
                <a href='#'>Privacy Policy</a>
                <a href='#'>Terms of Service</a>
                <a href='#'>Help Center</a>
            </footer>
        </div>
    )
}

export default Home