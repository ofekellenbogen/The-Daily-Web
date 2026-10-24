// Used to enforce "max 3 comments per minute per device".
// One document per device, holding the times of its recent comments.
const mongoose = require('mongoose');

const commentRateLimitSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  stamps: { type: [Date], default: [] }, // times of comments in the last minute
  allowed: { type: Boolean }, // result of the latest check (written by the atomic update)
  expiresAt: { type: Date, required: true }
});

// TTL index: MongoDB deletes the document once the device has been quiet for a minute.
commentRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CommentRateLimit', commentRateLimitSchema);
