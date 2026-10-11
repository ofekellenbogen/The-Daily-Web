const mongoose = require('mongoose');

// Recent comment times per browser for the comment limit; idle entries are removed by the TTL index.
const commentRateLimitSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  stamps: { type: [Date], default: [] },
  allowed: { type: Boolean },
  expiresAt: { type: Date, required: true }
});

commentRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CommentRateLimit', commentRateLimitSchema);
