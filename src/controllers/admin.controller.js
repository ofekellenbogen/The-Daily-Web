// User management page and the generic admin CRUD API (editors only).
// `:resource` in the URL is one of: users, comments, stats (see services/admin.service.js).
const adminService = require('../services/admin.service');
const logger = require('../utils/logger');

// GET /editor/users - the user management page (public/js/users.js does the Ajax work).
function usersPage(req, res) {
  res.render('staff/users', { title: 'ניהול משתמשים' });
}

// GET /api/admin/:resource?q=&page=
async function list(req, res) {
  res.json(await adminService.list(req.params.resource, req.query));
}

// GET /api/admin/:resource/:id
async function get(req, res) {
  res.json({ data: await adminService.get(req.params.resource, req.params.id) });
}

// POST /api/admin/:resource
async function create(req, res) {
  const data = await adminService.create(req.params.resource, req.body);
  logger.info(`[admin] created ${req.params.resource}/${data._id} by ${req.user._id}`);
  res.status(201).json({ data });
}

// PATCH /api/admin/:resource/:id
async function update(req, res) {
  const data = await adminService.update(req.params.resource, req.params.id, req.body, req.user);
  logger.info(`[admin] updated ${req.params.resource}/${req.params.id} by ${req.user._id}`);
  res.json({ data });
}

// DELETE /api/admin/:resource/:id
async function remove(req, res) {
  await adminService.remove(req.params.resource, req.params.id, req.user);
  logger.info(`[admin] deleted ${req.params.resource}/${req.params.id} by ${req.user._id}`);
  res.status(204).end();
}

module.exports = { usersPage, list, get, create, update, remove };
