const express = require('express');
const feedController = require('./feed.controller');

const router = express.Router();

router.get('/', feedController.renderHome);
router.get('/api/articles', feedController.listArticles);

module.exports = router;
