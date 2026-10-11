const feedService = require('./feed.service');
const { CATEGORIES } = require('../../models/Article');

function renderHome(req, res) {
  res.render('public/home', { title: 'The Daily Web - חדשות', categories: CATEGORIES });
}

async function listArticles(req, res) {
  res.json(await feedService.getFeed(req.query, req.deviceId));
}

module.exports = { renderHome, listArticles };
