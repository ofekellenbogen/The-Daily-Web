const service = require('./staff.service');
const Article = require('../../models/Article');

async function get(req, res) {
  const article = await service.getArticle(req.params.id, req.user);
  const snapshot = article.publishedVersion;
  res.set('Cache-Control', 'no-store');
  res.json({ data: snapshot ? { ...snapshot.toObject(), categoryLabel: Article.CATEGORIES[snapshot.category] || snapshot.category } : null });
}

module.exports = { get };
