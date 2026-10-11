const commentsService = require('./comments.service');
const { HttpError } = require('../../middleware/errors');

async function list(req, res) {
  await commentsService.ensurePublicArticle(req.params.id);
  res.json(await commentsService.listComments(req.params.id, req.query.cursor));
}

async function create(req, res) {
  // Without a cookie from an earlier visit every request would get a fresh device and skip the limit.
  if (req.isNewDevice) {
    throw new HttpError(403, 'DEVICE_REQUIRED', 'לא ניתן לזהות את הדפדפן. יש לאפשר עוגיות, לרענן את העמוד ולנסות שוב.');
  }
  const comment = await commentsService.createComment(req.params.id, req.body, req.deviceId);
  res.status(201).json({ data: comment });
}

module.exports = { list, create };
