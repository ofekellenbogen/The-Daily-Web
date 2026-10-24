// Impact Analytics page and its JSON API (editors only).
const analyticsService = require('../services/analytics.service');

// GET /editor/analytics - the page; the graph is drawn by public/js/analytics.js with Chart.js.
function dashboard(req, res) {
  res.render('staff/analytics', { title: 'סטטיסטיקות' });
}

// GET /api/analytics/articles?q= - article picker search.
async function articles(req, res) {
  res.json(await analyticsService.listArticles(req.query));
}

// GET /api/analytics/articles/:id?start=&end= - graph data for one article.
async function article(req, res) {
  res.json(await analyticsService.getAnalytics(req.params.id, req.query));
}

module.exports = { dashboard, articles, article };
