// Reporter / editor workspace pages and the article management API.
// Controllers stay thin: read the request, call the service, send the response.
// All rules (ownership, allowed transitions, validation) live in services/staff.service.js.
const staffService = require('../services/staff.service');
const { CATEGORIES } = require('../models/Article');

const { STATUS_LABELS } = staffService;

// ===== Pages (EJS) ================================================================

// GET /reporter and GET /editor - the article list (first page rendered on the server).
async function workspace(req, res) {
  res.render('staff/workspace', {
    title: req.user.role === 'editor' ? 'אזור ניהול תוכן' : 'אזור העבודה שלי',
    ...await staffService.listArticles(req.user, req.query),
    selectedStatus: req.query.status || '',
    selectedQuery: req.query.q || '',
    statusLabels: STATUS_LABELS
  });
}

// GET /staff/articles/new
function newArticle(req, res) {
  res.render('staff/article-editor', { title: 'כתבה חדשה', article: null, categories: CATEGORIES, statusLabels: STATUS_LABELS });
}

// GET /staff/articles/:id - always loads the latest saved working copy from MongoDB,
// so work continues after a refresh, a browser restart or on another computer.
async function editArticle(req, res) {
  res.render('staff/article-editor', {
    title: 'עריכת כתבה',
    article: await staffService.getArticle(req.params.id, req.user),
    categories: CATEGORIES,
    statusLabels: STATUS_LABELS
  });
}

// ===== REST API (JSON) ============================================================

// GET /api/staff/articles?status=&q=&page=
async function list(req, res) {
  res.json({ ...await staffService.listArticles(req.user, req.query), statusLabels: STATUS_LABELS });
}

// GET /api/staff/articles/:id
async function get(req, res) {
  res.json({ data: await staffService.getArticle(req.params.id, req.user) });
}

// POST /api/staff/articles
async function create(req, res) {
  const article = await staffService.createArticle(req.user, req.body);
  res.status(201).json({ id: String(article._id) });
}

// PATCH /api/staff/articles/:id
async function update(req, res) {
  const article = await staffService.updateArticle(req.params.id, req.user, req.body);
  res.json({ message: 'הכתבה נשמרה', statusLabel: STATUS_LABELS[article.workflowStatus] });
}

// PUT /api/staff/articles/:id - autosave (creates the article on its first save).
async function autosave(req, res) {
  const article = await staffService.saveDraft(req.params.id, req.user, req.body);
  res.json({
    id: String(article._id),
    workflowStatus: article.workflowStatus,
    statusLabel: STATUS_LABELS[article.workflowStatus],
    revision: article.revision
  });
}

// POST /api/staff/articles/:id/submit
async function submit(req, res) {
  await staffService.submitArticle(req.params.id, req.user);
  res.json({ message: 'הכתבה נשלחה לאישור' });
}

// POST /api/staff/articles/:id/approve
async function approve(req, res) {
  await staffService.approveArticle(req.params.id, req.user);
  res.json({ message: 'הכתבה פורסמה' });
}

// POST /api/staff/articles/:id/return - body: { note }
async function returnForCorrections(req, res) {
  await staffService.returnArticle(req.params.id, req.user, req.body?.note);
  res.json({ message: 'הכתבה הוחזרה לתיקונים' });
}

// DELETE /api/staff/articles/:id
async function remove(req, res) {
  await staffService.deleteArticle(req.params.id, req.user);
  res.status(204).end(); // 204 = success, no content
}

module.exports = {
  workspace, newArticle, editArticle,
  list, get, create, update, autosave, submit, approve, returnForCorrections, remove
};
