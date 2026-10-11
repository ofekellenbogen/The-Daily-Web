const express = require('express');
const feedController = require('./feed.controller');
const articleController = require('./article.controller');

const router = express.Router();

router.get('/', feedController.renderHome);
router.get('/api/articles', feedController.listArticles);
router.get('/articles/:id', articleController.renderArticle);

module.exports = router;
