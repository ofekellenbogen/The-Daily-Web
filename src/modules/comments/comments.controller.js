const commentsService = require('./comments.service');

async function list(req, res) {
  await commentsService.ensurePublicArticle(req.params.id);
  res.json(await commentsService.listComments(req.params.id, req.query.cursor));
}

async function create(req, res) {
  const comment = await commentsService.createComment(req.params.id, req.body, req.deviceId);
  res.status(201).json({ data: comment });
}

module.exports = { list, create };
