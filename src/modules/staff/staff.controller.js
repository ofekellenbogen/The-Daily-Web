const service = require('./staff.service');
const Article = require('../../models/Article');

async function workspace(req, res) {
  res.render('staff/workspace', {
    title: req.user.role === 'editor' ? 'אזור ניהול תוכן' : 'אזור העבודה שלי',
    ...await service.listArticles(req.user, req.query),
    selectedStatus: req.query.status || '',
    statusLabels: service.STATUS_LABELS
  });
}

async function list(req, res) {
  res.json({ ...await service.listArticles(req.user, req.query), statusLabels: service.STATUS_LABELS });
}

function newArticle(req, res) {
  res.render('staff/edit', { title: 'כתבה חדשה', article: null, categories: Article.CATEGORIES, statusLabels: service.STATUS_LABELS });
}

async function editArticle(req, res) {
  res.render('staff/edit', {
    title: 'עריכת כתבה', article: await service.getArticle(req.params.id, req.user),
    categories: Article.CATEGORIES, statusLabels: service.STATUS_LABELS
  });
}

async function create(req, res) {
  const article = await service.createArticle(req.user, req.body);
  res.status(201).json({ id: String(article._id) });
}

async function update(req, res) {
  const article = await service.updateArticle(req.params.id, req.user, req.body);
  res.json({ message: 'הכתבה נשמרה', statusLabel: service.STATUS_LABELS[article.workflowStatus] });
}

async function submit(req, res) {
  await service.transitionArticle(req.params.id, req.user, 'submit');
  res.json({ message: 'הכתבה נשלחה לאישור' });
}

async function approve(req, res) {
  await service.transitionArticle(req.params.id, req.user, 'approve');
  res.json({ message: 'הכתבה פורסמה' });
}

async function returnForCorrections(req, res) {
  await service.transitionArticle(req.params.id, req.user, 'return', req.body?.note);
  res.json({ message: 'הכתבה הוחזרה לתיקונים' });
}

async function remove(req, res) {
  await service.deleteArticle(req.params.id, req.user);
  res.status(204).end();
}

module.exports = { workspace, list, newArticle, editArticle, create, update, submit, approve, returnForCorrections, remove };
