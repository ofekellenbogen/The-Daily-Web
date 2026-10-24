// Public comments API (used by public/js/comments.js on the article page).
const commentService = require('../services/comment.service');
const HttpError = require('../utils/HttpError');

// GET /api/articles/:id/comments?cursor= - the next 20 comments ("load more").
async function list(req, res) {
  await commentService.ensurePublicArticle(req.params.id);
  res.json(await commentService.listComments(req.params.id, req.query.cursor));
}

// POST /api/articles/:id/comments - body: { authorName, body }
async function create(req, res) {
  // The device cookie is how the 3-per-minute limit is counted. A request without the cookie
  // from an earlier visit would get a brand-new device every time and bypass the limit.
  if (req.isNewDevice) {
    throw new HttpError(403, 'DEVICE_REQUIRED', 'לא ניתן לזהות את הדפדפן. יש לאפשר עוגיות, לרענן את העמוד ולנסות שוב.');
  }
  const comment = await commentService.createComment(req.params.id, req.body, req.deviceId);
  res.status(201).json({ data: comment }); // 201 = Created
}

module.exports = { list, create };
