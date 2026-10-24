const express = require('express');
const controller = require('./staff.controller');
const { requireAuth, requireRole, sameOrigin } = require('../../middleware/auth');

const router = express.Router();
const reporter = requireRole('reporter');
const editor = requireRole('editor');

router.get('/reporter', requireAuth, reporter, controller.workspace);
router.get('/editor', requireAuth, editor, controller.workspace);
router.get('/staff/articles/new', requireAuth, controller.newArticle);
router.get('/staff/articles/:id', requireAuth, controller.editArticle);

router.use('/api/staff', requireAuth, sameOrigin);
router.get('/api/staff/articles', controller.list);
router.put('/api/staff/drafts/:id', controller.autosave);
router.post('/api/staff/articles', controller.create);
router.patch('/api/staff/articles/:id', controller.update);
router.post('/api/staff/articles/:id/submit', reporter, controller.submit);
router.post('/api/staff/articles/:id/approve', editor, controller.approve);
router.post('/api/staff/articles/:id/return', editor, controller.returnForCorrections);
router.get('/api/staff/articles/:id/published', require('./published.controller').get);
router.delete('/api/staff/articles/:id', editor, controller.remove);

router.get('/api/staff/articles/:id', async (req, res) => {
  res.json({ data: await require('./staff.service').getArticle(req.params.id, req.user) });
});

module.exports = router;
