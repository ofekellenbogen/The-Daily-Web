const express = require('express');
const commentsController = require('./comments.controller');

const router = express.Router();

router.get('/api/articles/:id/comments', commentsController.list);
router.post('/api/articles/:id/comments', commentsController.create);

module.exports = router;
