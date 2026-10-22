const express = require('express');
const controller = require('./staff.controller');
const { requireAuth, requireRole, sameOrigin } = require('../../middleware/auth');

const router = express.Router();
const reporter = requireRole('reporter');

router.get('/reporter', requireAuth, reporter, controller.workspace);
router.get('/staff/articles/new', requireAuth, reporter, controller.newArticle);
router.get('/staff/articles/:id', requireAuth, reporter, controller.editArticle);

router.use('/api/staff', requireAuth, reporter, sameOrigin);
router.get('/api/staff/articles', controller.list);
router.post('/api/staff/articles', reporter, controller.create);
router.patch('/api/staff/articles/:id', controller.update);
router.post('/api/staff/articles/:id/submit', reporter, controller.submit);

module.exports = router;
