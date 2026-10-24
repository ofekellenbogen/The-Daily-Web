// Reporter / editor routes. Every route requires login; some also require a specific role.
// The service layer additionally checks ownership (a reporter can only touch their own articles).
const express = require('express');
const controller = require('../controllers/staff.controller');
const { requireAuth, requireRole, sameOrigin } = require('../middleware/auth');

const router = express.Router();
const reporterOnly = requireRole('reporter');
const editorOnly = requireRole('editor');

// Pages
router.get('/reporter', requireAuth, reporterOnly, controller.workspace);
router.get('/editor', requireAuth, editorOnly, controller.workspace);
router.get('/staff/articles/new', requireAuth, controller.newArticle);
router.get('/staff/articles/:id', requireAuth, controller.editArticle);

// JSON API - login + same-origin check for everything under /api/staff
router.use('/api/staff', requireAuth, sameOrigin);

router.get('/api/staff/articles', controller.list); //                       list (own / all)
router.post('/api/staff/articles', controller.create); //                    create
router.get('/api/staff/articles/:id', controller.get); //                    read
router.put('/api/staff/articles/:id', controller.autosave); //               autosave (create or update)
router.patch('/api/staff/articles/:id', controller.update); //               update
router.delete('/api/staff/articles/:id', editorOnly, controller.remove); //  delete

// Workflow transitions
router.post('/api/staff/articles/:id/submit', reporterOnly, controller.submit);
router.post('/api/staff/articles/:id/approve', editorOnly, controller.approve);
router.post('/api/staff/articles/:id/return', editorOnly, controller.returnForCorrections);

module.exports = router;
