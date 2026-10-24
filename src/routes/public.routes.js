// Public routes, open to guests: home feed, article pages and comments.
const express = require('express');
const feedController = require('../controllers/feed.controller');
const articleController = require('../controllers/article.controller');
const commentController = require('../controllers/comment.controller');

const router = express.Router();

// Pages
router.get('/', feedController.renderHome);
router.get('/articles/:id', articleController.renderArticle);
router.get('/article-images/:id.svg', articleController.renderArticleImage);

// JSON API
router.get('/api/articles', feedController.listArticles);
router.get('/api/articles/:id/comments', commentController.list);
router.post('/api/articles/:id/comments', commentController.create);

module.exports = router;
