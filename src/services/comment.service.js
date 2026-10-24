// Public comments: list, count and create comments on published articles.
const mongoose = require('mongoose');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const HttpError = require('../utils/HttpError');
const { PAGE_SIZE, isObjectId } = require('../utils/validation');
const rateLimit = require('./commentRateLimit.service');

const { MAX_NAME_LENGTH, MAX_BODY_LENGTH } = Comment;
const GUEST_NAME = 'אורח';
const NEWEST_FIRST = { createdAt: -1, _id: -1 };

// Validates { authorName, body }. Returns per-field Hebrew messages so the form can show them.
// Also used by the admin service when an editor edits a comment.
function parseCommentInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const authorName = typeof source.authorName === 'string' ? source.authorName.trim() : '';
  const body = typeof source.body === 'string' ? source.body.trim() : '';

  const fields = {};
  if (authorName.length > MAX_NAME_LENGTH) fields.authorName = `השם מוגבל ל-${MAX_NAME_LENGTH} תווים`;
  if (!body) fields.body = 'יש לכתוב את תוכן התגובה';
  else if (body.length > MAX_BODY_LENGTH) fields.body = `התגובה מוגבלת ל-${MAX_BODY_LENGTH} תווים`;

  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'התגובה אינה תקינה', fields);
  }
  return { authorName: authorName || GUEST_NAME, body }; // name is optional
}

// --- Cursor pagination ---------------------------------------------------------
// "Load more" sends back a cursor that points to the last comment already shown.
// It's safer than page numbers: new comments arriving at the top don't cause
// the next page to repeat or skip comments. Cursor = base64("<createdAt>|<_id>").

function invalidCursor() {
  return new HttpError(400, 'INVALID_CURSOR', 'מצביע דפדוף לא תקין', { cursor: 'invalid' });
}

function encodeCursor(comment) {
  return Buffer.from(`${comment.createdAt.toISOString()}|${comment._id}`).toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string') throw invalidCursor();
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(iso);
  if (!isObjectId(id) || Number.isNaN(date.getTime())) throw invalidCursor();
  return { date, id: new mongoose.Types.ObjectId(id) };
}

// Only these fields are sent to the browser (deviceId stays private).
function toPublicComment(doc) {
  return {
    id: String(doc._id),
    authorName: doc.authorName,
    body: doc.body,
    createdAt: doc.createdAt.toISOString()
  };
}

// Comments are only open on articles that have an approved public version.
async function ensurePublicArticle(articleId) {
  const exists =
    isObjectId(articleId) &&
    (await Article.exists({ _id: articleId, 'publishedVersion.publishedAt': { $ne: null } }));
  if (!exists) throw new HttpError(404, 'NOT_FOUND', 'הכתבה המבוקשת לא נמצאה');
}

// Returns 20 comments, newest first, plus the cursor for the next 20.
async function listComments(articleId, cursor) {
  const query = { articleId };
  if (cursor) {
    const { date, id } = decodeCursor(cursor);
    // "Older than the last shown comment". Two comments can share a createdAt, so _id breaks the tie.
    query.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: id } }];
  }

  // Ask for one extra comment just to know whether another page exists.
  const docs = await Comment.find(query)
    .select('authorName body createdAt')
    .sort(NEWEST_FIRST)
    .limit(PAGE_SIZE + 1)
    .lean();
  const hasMore = docs.length > PAGE_SIZE;
  const page = docs.slice(0, PAGE_SIZE);
  return {
    data: page.map(toPublicComment),
    meta: { nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null, hasMore }
  };
}

function countComments(articleId) {
  return Comment.countDocuments({ articleId });
}

async function createComment(articleId, input, deviceId, user) {
  // A logged-in user always comments under their own name; only guests choose a name.
  const source = user ? { ...input, authorName: String(user.displayName).slice(0, MAX_NAME_LENGTH) } : input;
  const fields = parseCommentInput(source);
  await ensurePublicArticle(articleId);

  // Spam protection: max 3 comments per minute per device (see commentRateLimit.service.js).
  const slot = await rateLimit.takeCommentSlot(deviceId);
  if (!slot.allowed) {
    const seconds = Math.ceil(slot.retryAfterMs / 1000);
    const error = new HttpError(
      429, // "Too Many Requests"
      'RATE_LIMITED',
      `ניתן לפרסם עד ${rateLimit.MAX_COMMENTS} תגובות בדקה. נסו שוב בעוד ${seconds} שניות.`
    );
    error.retryAfterSeconds = seconds;
    throw error;
  }

  const comment = await Comment.create({ articleId, ...fields, deviceId });
  return toPublicComment(comment);
}

module.exports = {
  listComments,
  countComments,
  createComment,
  ensurePublicArticle,
  parseCommentInput,
  encodeCursor,
  decodeCursor
};
