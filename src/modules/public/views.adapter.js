const ViewStats = require('../../models/ViewStats');
const ArticleSeen = require('../../models/ArticleSeen');
const viewsService = require('../analytics/views.service');

// Recording views belongs to the analytics module; this adapter only calls it.

async function getPopularity(articleIds) {
  const rows = await ViewStats.aggregate([
    { $match: { articleId: { $in: articleIds } } },
    { $group: { _id: '$articleId', total: { $sum: '$total' } } }
  ]);
  return new Map(rows.map((row) => [String(row._id), row.total]));
}

async function getSeenArticleIds(deviceId) {
  return ArticleSeen.distinct('articleId', { deviceId });
}

// Every visit counts as a view, while the seen mark is stored once per browser.
async function recordVisit(articleId, deviceId) {
  await Promise.all([viewsService.recordView(articleId), viewsService.markSeen(deviceId, articleId)]);
}

module.exports = { getPopularity, getSeenArticleIds, recordVisit };
