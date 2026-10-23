const service = require('./analytics.service');

function dashboard(req, res) {
  res.render('staff/analytics', { title: 'סטטיסטיקות' });
}

async function articles(req, res) {
  res.json(await service.listArticles(req.query));
}

async function article(req, res) {
  res.json(await service.getAnalytics(req.params.id, req.query));
}

module.exports = { dashboard, articles, article };