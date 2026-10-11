const ViewStats = require('../../models/ViewStats');
const ArticleSeen = require('../../models/ArticleSeen');
const viewsService = require('../analytics/views.service');

// Recording views belongs to the analytics module; this adapter only calls it.

const POPULARITY_TTL_MS = 60 * 1000;
let popularityCache = { expiresAt: 0, totals: null };

// Totals for all articles are computed at most once a minute and shared by every reader.
function getPopularity() {
  if (popularityCache.totals && popularityCache.expiresAt > Date.now()) {
    return popularityCache.totals;
  }
  const totals = ViewStats.aggregate([{ $group: { _id: '$articleId', total: { $sum: '$total' } } }]).then(
    (rows) => new Map(rows.map((row) => [String(row._id), row.total]))
  );
  popularityCache = { expiresAt: Date.now() + POPULARITY_TTL_MS, totals };
  totals.catch(() => {
    if (popularityCache.totals === totals) popularityCache = { expiresAt: 0, totals: null };
  });
  return totals;
}

async function getSeenArticleIds(deviceId) {
  return ArticleSeen.distinct('articleId', { deviceId });
}

// Every visit counts as a view, while the seen mark is stored once per browser.
async function recordVisit(articleId, deviceId) {
  await Promise.all([viewsService.recordView(articleId), viewsService.markSeen(deviceId, articleId)]);
}

module.exports = { getPopularity, getSeenArticleIds, recordVisit };
