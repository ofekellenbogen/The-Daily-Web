// Impact Analytics routes (editors only).
const express = require('express');
const controller = require('../controllers/analytics.controller');
const { requireAuth, requireRole, sameOrigin } = require('../middleware/auth');

const router = express.Router();
const editorOnly = requireRole('editor');

router.get('/editor/analytics', requireAuth, editorOnly, controller.dashboard);

// The statistics change constantly, so the browser must not cache API answers.
router.use('/api/analytics', requireAuth, editorOnly, sameOrigin, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/api/analytics/overview', controller.overview);
router.get('/api/analytics/articles', controller.articles);
router.get('/api/analytics/articles/:id', controller.article);

module.exports = router;
