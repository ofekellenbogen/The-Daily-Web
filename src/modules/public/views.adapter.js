const ViewStats = require('../../models/ViewStats');
const ArticleSeen = require('../../models/ArticleSeen');

// Read-only access to view data; recording views belongs to the analytics module.

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

module.exports = { getPopularity, getSeenArticleIds };
