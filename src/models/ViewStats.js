// View statistics model (used by Impact Analytics and "sort by popularity").
//
// Why this design: the site may have thousands of readers at once. Saving one document
// per view would create millions of documents. Instead there is ONE document per
// article per day, and each view only increments a counter inside it ($inc is atomic,
// so simultaneous views never overwrite each other).
//
// buckets: a map of "5-minute slot" -> views in that slot.
//   A day has 24 * 60 / 5 = 288 slots (0-287). Slot 168 = 14:00-14:05 UTC.
// total:   the sum of all buckets, for quick popularity sorting.
const mongoose = require('mongoose');

const viewStatsSchema = new mongoose.Schema({
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  dayUtc: { type: Date, required: true }, // midnight UTC of the day
  total: { type: Number, default: 0, min: 0 },
  buckets: { type: Map, of: Number, default: {} }
});

// Unique: guarantees a single document per article per day.
viewStatsSchema.index({ articleId: 1, dayUtc: 1 }, { unique: true });

module.exports = mongoose.model('ViewStats', viewStatsSchema);
