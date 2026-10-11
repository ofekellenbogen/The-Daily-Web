const mongoose = require('mongoose');

// Which browser (deviceId cookie) has opened which article; one row per pair.
const articleSeenSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  firstSeenAt: { type: Date, default: Date.now }
});

articleSeenSchema.index({ deviceId: 1, articleId: 1 }, { unique: true });

module.exports = mongoose.model('ArticleSeen', articleSeenSchema);
