const express = require('express');
const controller = require('./analytics.controller');
const { requireAuth, requireRole, sameOrigin } = require('../../middleware/auth');

const router = express.Router();
const editor = requireRole('editor');

router.get('/editor/analytics', requireAuth, editor, controller.dashboard);
router.use('/api/analytics', requireAuth, editor, sameOrigin, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/api/analytics/articles', controller.articles);
router.get('/api/analytics/articles/:id', controller.article);

module.exports = router;