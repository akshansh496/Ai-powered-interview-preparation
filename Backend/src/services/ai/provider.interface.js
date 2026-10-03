/**
 * Abstract Base Class defining the contract for all AI providers.
 * Every provider (Gemini, OpenRouter, future OpenAI, etc.) must implement this interface.
 */
class AIProvider {
    /**
     * @param {string} name - Unique identifier of the provider (e.g. 'gemini', 'openrouter')
     * @param {string} defaultModel - Default model name to use for this provider
     */
    constructor(name, defaultModel) {
        if (new.target === AIProvider) {
            throw new TypeError("Cannot instantiate abstract AIProvider directly.");
        }
        this.name = name;
        this.defaultModel = defaultModel;
    }

    /**
     * Model name currently configured for this provider.
     * @returns {string}
     */
    get model() {
        return this.defaultModel;
    }

    /**
     * Checks if the provider is available and properly configured (e.g., API key present).
     * @returns {boolean}
     */
    isAvailable() {
        throw new Error(`isAvailable() must be implemented by ${this.name} provider.`);
    }

    /**
     * Generates a structured interview preparation report.
     * @param {Object} params
     * @param {string} [params.resume]
     * @param {string} [params.selfDescription]
     * @param {string} params.jobDescription
     * @param {number} [params.daysUntilInterview]
     * @param {Object} [options]
     * @returns {Promise<Object>} Formatted report object conforming to interviewReportSchema
     */
    async generateInterviewReport(params, options = {}) {
        throw new Error(`generateInterviewReport() must be implemented by ${this.name} provider.`);
    }

    /**
     * Generates an ATS-friendly tailored resume in HTML format.
     * @param {Object} params
     * @param {string} [params.resume]
     * @param {string} [params.selfDescription]
     * @param {string} params.jobDescription
     * @param {Object} [options]
     * @returns {Promise<string>} HTML string
     */
    async generateResumePdf(params, options = {}) {
        throw new Error(`generateResumePdf() must be implemented by ${this.name} provider.`);
    }
}

module.exports = {
    AIProvider
};
