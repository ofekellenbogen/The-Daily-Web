// Home page and the news feed API.
const feedService = require('../services/feed.service');
const { CATEGORIES } = require('../models/Article');

// GET / - renders the page shell. The article cards are loaded by public/js/feed.js via Ajax.
function renderHome(req, res) {
  res.render('public/home', { title: 'The Daily Web - חדשות', categories: CATEGORIES });
}

// GET /api/articles?q=&category=&seen=&sort=&cursor= - one page of feed cards as JSON.
async function listArticles(req, res) {
  res.json(await feedService.getFeed(req.query, req.deviceId));
}

module.exports = { renderHome, listArticles };
