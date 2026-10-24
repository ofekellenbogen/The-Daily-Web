// Remembers which device (browser) has already opened which article.
// Powers the "seen / unseen" filter on the home page. One document per (device, article) pair.
const mongoose = require('mongoose');

const articleSeenSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  firstSeenAt: { type: Date, default: Date.now }
});

articleSeenSchema.index({ deviceId: 1, articleId: 1 }, { unique: true });

module.exports = mongoose.model('ArticleSeen', articleSeenSchema);
