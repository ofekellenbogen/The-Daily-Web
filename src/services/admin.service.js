// Editor-only CRUD (Create, Read/List/Search, Update, Delete) for three models:
//   users     - accounts of reporters and editors   (UI: /editor/users)
//   comments  - moderate reader comments            (UI: delete button on the article page)
//   stats     - view statistics buckets             (REST API only)
// Articles have their own CRUD in staff.service.js.
//
// Routes: GET/POST /api/admin/:resource and GET/PATCH/DELETE /api/admin/:resource/:id
const User = require('../models/User');
const Comment = require('../models/Comment');
const ViewStats = require('../models/ViewStats');
const Article = require('../models/Article');
const Session = require('../models/Session');
const { hashPassword } = require('../utils/password');
const HttpError = require('../utils/HttpError');
const { PAGE_SIZE, isObjectId, isPageNumber, containsText } = require('../utils/validation');
const { parseCommentInput } = require('./comment.service');

const MODELS = { users: User, comments: Comment, stats: ViewStats };

// Fields returned for each resource. Users never include passwordHash; comments never include deviceId.
const PUBLIC_FIELDS = {
  users: 'username displayName role',
  comments: 'articleId authorName body createdAt',
  stats: 'articleId dayUtc total buckets'
};

const SLOTS_PER_DAY = 288;
const MAX_VIEW_COUNT = 1000000000;

// ===== Validation helpers ========================================================

function fail(message, status = 400) {
  throw new HttpError(status, 'INVALID_DATA', message);
}

function getModel(resource) {
  if (!Object.hasOwn(MODELS, resource)) fail('סוג נתונים לא נמצא', 404);
  return MODELS[resource];
}

// Rejects anything that isn't a plain object, or that contains unexpected fields.
function requireFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key))) {
    fail('שדות לא תקינים');
  }
}

function requireText(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !value.trim()) fail('יש למלא טקסט באורך תקין');
  return value.trim();
}

function requireId(value) {
  if (!isObjectId(value)) fail('מזהה לא תקין');
  return value;
}

async function requireArticle(articleId) {
  requireId(articleId);
  if (!await Article.exists({ _id: articleId })) fail('הכתבה אינה קיימת', 404);
}

// { username, displayName, role, password }. Password is required when creating,
// optional when editing (empty = keep the current password).
function parseUser(input, creating) {
  requireFields(input, ['username', 'displayName', 'role', 'password']);
  const username = requireText(input.username, 100).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) fail('שם המשתמש יכיל אותיות באנגלית, מספרים, נקודה, מקף או קו תחתון');
  if (!User.ROLES.includes(input.role)) fail('תפקיד לא תקין');
  const data = { username, displayName: requireText(input.displayName, 100), role: input.role };

  if (input.password !== undefined && typeof input.password !== 'string') fail('סיסמה לא תקינה');
  if (creating || input.password) {
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 256) {
      fail('הסיסמה חייבת להכיל 8 עד 256 תווים');
    }
    data.password = input.password;
  }
  return data;
}

// Create: { articleId, dayUtc: 'YYYY-MM-DD', slot, count }.  Update: { slot, count }.
// `slot` is the 5-minute bucket of the day (0-287).
function parseStats(input, creating) {
  requireFields(input, creating ? ['articleId', 'dayUtc', 'slot', 'count'] : ['slot', 'count']);
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot >= SLOTS_PER_DAY ||
      !Number.isSafeInteger(input.count) || input.count < 0 || input.count > MAX_VIEW_COUNT) {
    fail('השעה או כמות הצפיות אינן תקינות');
  }
  const data = { slot: input.slot, count: input.count };
  if (creating) {
    requireId(input.articleId);
    if (typeof input.dayUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.dayUtc)) fail('תאריך לא תקין');
    const date = new Date(`${input.dayUtc}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.dayUtc) fail('תאריך לא תקין');
    data.articleId = input.articleId;
    data.dayUtc = date;
  }
  return data;
}

function safeUser(user) {
  return { _id: user._id, username: user.username, displayName: user.displayName, role: user.role };
}

// ===== CRUD ======================================================================

// List + search, 20 per page. Search: users by username/name, comments by name/text,
// stats by article id.
async function list(resource, query = {}) {
  const Model = getModel(resource);
  const page = query.page || '1';
  const q = query.q || '';
  if (!isPageNumber(page) || typeof q !== 'string' || q.length > 100) fail('חיפוש או עמוד לא תקינים');

  const filter = {};
  const search = q.trim();
  if (search) {
    if (resource === 'users') filter.$or = [{ username: containsText(search) }, { displayName: containsText(search) }];
    else if (resource === 'comments') filter.$or = [{ authorName: containsText(search) }, { body: containsText(search) }];
    else filter.articleId = requireId(search);
  }

  const rows = await Model.find(filter)
    .select(PUBLIC_FIELDS[resource])
    .sort({ _id: -1 }) // newest first
    .skip((Number(page) - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE + 1)
    .lean();
  return { data: rows.slice(0, PAGE_SIZE), nextPage: rows.length > PAGE_SIZE ? Number(page) + 1 : null };
}

async function get(resource, recordId) {
  const row = await getModel(resource).findById(requireId(recordId)).select(PUBLIC_FIELDS[resource]).lean();
  if (!row) fail('הרשומה אינה קיימת', 404);
  return row;
}

async function create(resource, input) {
  getModel(resource);

  if (resource === 'users') {
    const { password, ...data } = parseUser(input, true);
    const user = await User.create({ ...data, passwordHash: await hashPassword(password) });
    return safeUser(user);
  }

  if (resource === 'comments') {
    requireFields(input, ['articleId', 'authorName', 'body']);
    await requireArticle(input.articleId); // a comment must belong to an existing article
    const row = await Comment.create({
      articleId: input.articleId,
      ...parseCommentInput(input),
      deviceId: 'editor-moderation'
    });
    return { _id: row._id, articleId: row.articleId, authorName: row.authorName, body: row.body };
  }

  // stats
  const data = parseStats(input, true);
  await requireArticle(data.articleId);
  return ViewStats.create({
    articleId: data.articleId,
    dayUtc: data.dayUtc,
    buckets: { [data.slot]: data.count },
    total: data.count
  });
}

async function update(resource, recordId, input, actor) {
  getModel(resource);
  requireId(recordId);

  if (resource === 'users') {
    const { password, ...data } = parseUser(input, false);
    // An editor can't remove their own editor role (the system could be left without editors).
    if (String(actor._id) === recordId && data.role !== 'editor') fail('לא ניתן להסיר מעצמך הרשאת עורך', 409);
    if (password) data.passwordHash = await hashPassword(password);
    const row = await User.findByIdAndUpdate(recordId, { $set: data }, { returnDocument: 'after', runValidators: true });
    if (!row) fail('משתמש לא נמצא', 404);
    // A new password logs the user out everywhere.
    if (data.passwordHash) await Session.deleteMany({ userId: recordId });
    return safeUser(row);
  }

  if (resource === 'comments') {
    requireFields(input, ['authorName', 'body']);
    const row = await Comment.findByIdAndUpdate(recordId, { $set: parseCommentInput(input) }, {
      returnDocument: 'after', runValidators: true
    }).select(PUBLIC_FIELDS.comments);
    if (!row) fail('תגובה לא נמצאה', 404);
    return row;
  }

  // stats: replace one bucket's count and fix the daily total in the SAME atomic update:
  //   total = total - oldBucketValue + newCount
  // (a pipeline update can read the current values, so concurrent views stay consistent).
  const { slot, count } = parseStats(input, false);
  const bucket = `buckets.${slot}`;
  const row = await ViewStats.findByIdAndUpdate(recordId, [{
    $set: {
      total: { $add: [{ $subtract: ['$total', { $ifNull: [`$${bucket}`, 0] }] }, count] },
      [bucket]: count
    }
  }], { returnDocument: 'after', updatePipeline: true });
  if (!row) fail('נתוני צפייה לא נמצאו', 404);
  return row;
}

async function remove(resource, recordId, actor) {
  const Model = getModel(resource);
  requireId(recordId);

  if (resource === 'users') {
    if (String(actor._id) === recordId) fail('לא ניתן למחוק את החשבון המחובר', 409);
    // Deleting an author would leave articles without an owner.
    if (await Article.exists({ authorId: recordId })) fail('למשתמש יש כתבות. יש לטפל בהן לפני מחיקתו', 409);
  }
  if (!await Model.findByIdAndDelete(recordId)) fail('הרשומה אינה קיימת', 404);
  if (resource === 'users') await Session.deleteMany({ userId: recordId });
}

module.exports = { list, get, create, update, remove, parseUser, parseStats };
