const service = require('./staff.service');
const Article = require('../../models/Article');

async function workspace(req, res) {
  res.render('staff/workspace', {
    title: 'אזור העבודה שלי',
    articles: await service.listArticles(req.user),
    statusLabels: service.STATUS_LABELS
  });
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
  await service.updateArticle(req.params.id, req.user, req.body);
  res.json({ message: 'הכתבה נשמרה' });
}

async function submit(req, res) {
  await service.transitionArticle(req.params.id, req.user, 'submit');
  res.json({ message: 'הכתבה נשלחה לאישור' });
}

module.exports = { workspace, newArticle, editArticle, create, update, submit };
