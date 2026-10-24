const User = require('../../models/User');
const Comment = require('../../models/Comment');
const ViewStats = require('../../models/ViewStats');
const Article = require('../../models/Article');
const Session = require('../../models/Session');
const { hashPassword } = require('../../utils/password');
const { isObjectId } = require('../../utils/objectId');
const { HttpError } = require('../../middleware/errors');
const { parseCommentInput } = require('../comments/comments.service');

const MODELS = { users: User, comments: Comment, stats: ViewStats };
const PROJECTIONS = { users: 'username displayName role', comments: 'articleId authorName body createdAt', stats: 'articleId dayUtc total buckets' };
const fail = (message, status = 400) => { throw new HttpError(status, 'INVALID_DATA', message); };
function model(resource) {
  if (!Object.hasOwn(MODELS, resource)) fail('סוג נתונים לא נמצא', 404);
  return MODELS[resource];
}
function object(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('שדות לא תקינים');
}
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('יש למלא טקסט באורך תקין');
  return value.trim();
}
function id(value) {
  if (!isObjectId(value)) fail('מזהה לא תקין');
  return value;
}
function parseUser(input, creating) {
  object(input, ['username', 'displayName', 'role', 'password']);
  const username = text(input.username, 100).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) fail('שם המשתמש יכיל אותיות באנגלית, מספרים, נקודה, מקף או קו תחתון');
  if (!['reporter', 'editor'].includes(input.role)) fail('תפקיד לא תקין');
  const data = { username, displayName: text(input.displayName, 100), role: input.role };
  if (input.password !== undefined && typeof input.password !== 'string') fail('סיסמה לא תקינה');
  if (creating || input.password) {
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 256) fail('הסיסמה חייבת להכיל 8 עד 256 תווים');
    data.password = input.password;
  }
  return data;
}
function parseStats(input, creating) {
  object(input, creating ? ['articleId', 'dayUtc', 'slot', 'count'] : ['slot', 'count']);
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 287 ||
      !Number.isSafeInteger(input.count) || input.count < 0 || input.count > 1000000000) fail('השעה או כמות הצפיות אינן תקינות');
  const data = { slot: input.slot, count: input.count };
  if (creating) {
    id(input.articleId);
    if (typeof input.dayUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.dayUtc)) fail('תאריך לא תקין');
    const date = new Date(`${input.dayUtc}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.dayUtc) fail('תאריך לא תקין');
    Object.assign(data, { articleId: input.articleId, dayUtc: date });
  }
  return data;
}
async function requireArticle(articleId) {
  id(articleId);
  if (!await Article.exists({ _id: articleId })) fail('הכתבה אינה קיימת', 404);
}
async function list(resource, query = {}) {
  const Model = model(resource);
  const page = query.page || '1', q = query.q || '';
  if (typeof page !== 'string' || !/^[1-9]\d{0,4}$/.test(page) || typeof q !== 'string' || q.length > 100) fail('חיפוש או עמוד לא תקינים');
  const filter = {};
  if (q.trim()) {
    const regex = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (resource === 'users') filter.$or = [{ username: regex }, { displayName: regex }];
    else if (resource === 'comments') filter.$or = [{ authorName: regex }, { body: regex }];
    else filter.articleId = id(q.trim());
  }
  const rows = await Model.find(filter).select(PROJECTIONS[resource]).sort({ _id: -1 }).skip((Number(page) - 1) * 20).limit(21).lean();
  return { data: rows.slice(0, 20), nextPage: rows.length > 20 ? Number(page) + 1 : null };
}
async function get(resource, recordId) {
  const row = await model(resource).findById(id(recordId)).select(PROJECTIONS[resource]).lean();
  if (!row) fail('הרשומה אינה קיימת', 404);
  return row;
}
function safeUser(user) {
  return { _id: user._id, username: user.username, displayName: user.displayName, role: user.role };
}
async function create(resource, input) {
  model(resource);
  if (resource === 'users') {
    const data = parseUser(input, true);
    const passwordHash = await hashPassword(data.password); delete data.password;
    return safeUser(await User.create({ ...data, passwordHash }));
  }
  if (resource === 'comments') {
    object(input, ['articleId', 'authorName', 'body']);
    await requireArticle(input.articleId);
    const row = await Comment.create({ articleId: input.articleId, ...parseCommentInput(input), deviceId: 'editor-moderation' });
    return { _id: row._id, articleId: row.articleId, authorName: row.authorName, body: row.body };
  }
  const data = parseStats(input, true); await requireArticle(data.articleId);
  return ViewStats.create({ articleId: data.articleId, dayUtc: data.dayUtc, buckets: { [data.slot]: data.count }, total: data.count });
}
async function update(resource, recordId, input, actor) {
  model(resource); id(recordId);
  if (resource === 'users') {
    const data = parseUser(input, false);
    if (String(actor._id) === recordId && data.role !== 'editor') fail('לא ניתן להסיר מעצמך הרשאת עורך', 409);
    if (data.password) { data.passwordHash = await hashPassword(data.password); delete data.password; }
    const row = await User.findByIdAndUpdate(recordId, { $set: data }, { returnDocument: 'after', runValidators: true });
    if (!row) fail('משתמש לא נמצא', 404);
    // Role/password changes take effect on other devices immediately.
    if (data.passwordHash) await Session.deleteMany({ userId: recordId });
    return safeUser(row);
  }
  if (resource === 'comments') {
    object(input, ['authorName', 'body']);
    const row = await Comment.findByIdAndUpdate(recordId, { $set: parseCommentInput(input) }, { returnDocument: 'after', runValidators: true }).select(PROJECTIONS.comments);
    if (!row) fail('תגובה לא נמצאה', 404);
    return row;
  }
  const { slot, count } = parseStats(input, false);
  const bucket = `buckets.${slot}`;
  // Adjust the total atomically with the bucket; concurrent reader increments stay consistent.
  const row = await ViewStats.findByIdAndUpdate(recordId, [{ $set: {
    total: { $add: [{ $subtract: ['$total', { $ifNull: [`$${bucket}`, 0] }] }, count] }, [bucket]: count
  } }], { returnDocument: 'after', updatePipeline: true });
  if (!row) fail('נתוני צפייה לא נמצאו', 404);
  return row;
}
async function remove(resource, recordId, actor) {
  const Model = model(resource); id(recordId);
  if (resource === 'users') {
    if (String(actor._id) === recordId) fail('לא ניתן למחוק את החשבון המחובר', 409);
    if (await Article.exists({ authorId: recordId })) fail('למשתמש יש כתבות. יש לטפל בהן לפני מחיקתו', 409);
  }
  if (!await Model.findByIdAndDelete(recordId)) fail('הרשומה אינה קיימת', 404);
  if (resource === 'users') await Session.deleteMany({ userId: recordId });
}
module.exports = { list, get, create, update, remove, parseUser, parseStats };
