const mongoose = require('mongoose')

const blackListTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: [true, "Token is required to be in blacklist"],
        index: true
    }
}, {
    timestamps: true
})

// TTL index to automatically remove expired blacklist tokens after 24 hours (matching 1d JWT lifetime)
blackListTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 })

const tokenBlackListModel = mongoose.model("blacklistToken", blackListTokenSchema)

module.exports = tokenBlackListModel

