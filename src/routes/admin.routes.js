// Editor-only CRUD for users, comments and view statistics.
const express = require('express');
const controller = require('../controllers/admin.controller');
const { requireAuth, requireRole, sameOrigin } = require('../middleware/auth');

const router = express.Router();
const editorOnly = requireRole('editor');

router.get('/editor/users', requireAuth, editorOnly, controller.usersPage);

// :resource = users | comments | stats
router.use('/api/admin', requireAuth, editorOnly, sameOrigin);
router.get('/api/admin/:resource', controller.list);
router.post('/api/admin/:resource', controller.create);
router.get('/api/admin/:resource/:id', controller.get);
router.patch('/api/admin/:resource/:id', controller.update);
router.delete('/api/admin/:resource/:id', controller.remove);

module.exports = router;
