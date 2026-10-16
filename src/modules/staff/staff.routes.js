const express = require('express');
const controller = require('./staff.controller');
const { requireAuth, requireRole, sameOrigin } = require('../../middleware/auth');

const router = express.Router();
const reporter = requireRole('reporter');
const editor = requireRole('editor');

router.get('/reporter', requireAuth, reporter, controller.workspace);
router.get('/editor', requireAuth, editor, controller.workspace);
router.get('/staff/articles/new', requireAuth, reporter, controller.newArticle);
router.get('/staff/articles/:id', requireAuth, controller.editArticle);

router.use('/api/staff', requireAuth, sameOrigin);
router.post('/api/staff/articles', reporter, controller.create);
router.patch('/api/staff/articles/:id', controller.update);
router.post('/api/staff/articles/:id/submit', reporter, controller.submit);
router.post('/api/staff/articles/:id/approve', editor, controller.approve);
router.post('/api/staff/articles/:id/return', editor, controller.returnForCorrections);
router.delete('/api/staff/articles/:id', editor, controller.remove);

module.exports = router;
