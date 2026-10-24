// Records article views and answers questions about them.
// Used by: the article page (record a visit), the home feed ("seen" filter and popularity sort).
// See models/ViewStats.js for why views are stored in 5-minute buckets.
const ViewStats = require('../models/ViewStats');
const ArticleSeen = require('../models/ArticleSeen');

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const DUPLICATE_KEY = 11000; // MongoDB error code for a unique-index violation
const POPULARITY_CACHE_MS = 60 * 1000;

// Converts a time into its UTC day and 5-minute slot, e.g. 14:03 UTC -> slot 168.
function getBucket(timestamp) {
  const time = timestamp.getTime();
  const dayUtc = new Date(time - (time % DAY_MS));
  const slot = Math.floor((time - dayUtc.getTime()) / BUCKET_MS);
  return { dayUtc, slot };
}

// Two first-time upserts at the same moment can both try to insert and one fails on the
// unique index. Retrying once finds the document the other request created.
async function upsertWithRetry(run) {
  try {
    return await run();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return run();
  }
}

// Adds one view. A single atomic $inc updates both the slot and the daily total,
// so thousands of simultaneous readers are counted correctly.
function recordView(articleId, timestamp = new Date()) {
  const { dayUtc, slot } = getBucket(timestamp);
  return upsertWithRetry(() =>
    ViewStats.updateOne(
      { articleId, dayUtc },
      { $inc: { total: 1, [`buckets.${slot}`]: 1 } },
      { upsert: true } // create the day's document if it doesn't exist yet
    )
  );
}

// Marks the article as seen by this device ($setOnInsert = only the first time).
function markSeen(deviceId, articleId) {
  return upsertWithRetry(() =>
    ArticleSeen.updateOne(
      { deviceId, articleId },
      { $setOnInsert: { firstSeenAt: new Date() } },
      { upsert: true }
    )
  );
}

// Called on every article page load: every visit counts as a view,
// while the "seen" mark is stored once per device.
async function recordVisit(articleId, deviceId) {
  await Promise.all([recordView(articleId), markSeen(deviceId, articleId)]);
}

function getSeenArticleIds(deviceId) {
  return ArticleSeen.distinct('articleId', { deviceId });
}

// Total views per article (Map of articleId -> total), used to sort the feed by popularity.
// Summing all statistics is expensive, so the result is cached for one minute and shared
// by all readers. The cache holds the promise, so simultaneous requests share one query.
let popularityCache = { expiresAt: 0, totals: null };

function getPopularity() {
  if (popularityCache.totals && popularityCache.expiresAt > Date.now()) {
    return popularityCache.totals;
  }
  const totals = ViewStats.aggregate([{ $group: { _id: '$articleId', total: { $sum: '$total' } } }])
    .then((rows) => new Map(rows.map((row) => [String(row._id), row.total])));
  popularityCache = { expiresAt: Date.now() + POPULARITY_CACHE_MS, totals };
  // If the query fails, forget it so the next request tries again.
  totals.catch(() => {
    if (popularityCache.totals === totals) popularityCache = { expiresAt: 0, totals: null };
  });
  return totals;
}

module.exports = { getBucket, recordView, markSeen, recordVisit, getSeenArticleIds, getPopularity };
