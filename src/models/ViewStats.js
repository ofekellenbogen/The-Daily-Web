const mongoose = require('mongoose');

// One document per article per UTC day; buckets are 5-minute slots (0-287).
const viewStatsSchema = new mongoose.Schema({
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  dayUtc: { type: Date, required: true },
  total: { type: Number, default: 0, min: 0 },
  buckets: { type: Map, of: Number, default: {} }
});

viewStatsSchema.index({ articleId: 1, dayUtc: 1 }, { unique: true });

module.exports = mongoose.model('ViewStats', viewStatsSchema);
