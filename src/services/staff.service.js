// Article management for reporters and editors (the "staff").
//
// Workflow (which transitions are allowed):
//
//   new article ──► draft ──submit (reporter)──► pending ──approve (editor)──► published
//                     ▲                            │                            │
//                     │                    return + note (editor)               │
//                     │                            ▼                            │
//                     │                         returned ──submit──► pending    │
//                     └──────────── editing a published article ◄───────────────┘
//
//   - Only a pending article can be published or returned. An editor who edits a draft
//     (e.g. an update to a published article) sends it to pending first, like a reporter.
//   - Any other transition is rejected with 409 (Conflict).
//
// Published articles: edits change only `workingCopy`. Readers keep seeing `publishedVersion`
// until an editor approves, which copies workingCopy -> publishedVersion as a new version.
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const ArticleSeen = require('../models/ArticleSeen');
const ViewStats = require('../models/ViewStats');
const HttpError = require('../utils/HttpError');
const { PAGE_SIZE, isObjectId, isPageNumber, escapeRegex, containsText } = require('../utils/validation');
const { ARTICLE_IMAGE_PATTERN } = require('./articleImage.service');
const logger = require('../utils/logger');

const STATUS_LABELS = {
  draft: 'בהכנה',
  pending: 'ממתינה לאישור עורך',
  published: 'פורסמה',
  returned: 'הוחזרה לתיקונים'
};

// Max length for each field the client may send. Any other field (authorId, workflowStatus,
// publishedVersion...) is rejected, so a user can't forge ownership or publish by editing JSON.
const CONTENT_LIMITS = {
  title: 200, summary: 1000, body: 50000, category: 30, imageUrl: 2000, imageAlt: 250,
  imageCredit: 250, imageSourceUrl: 2000, imageLicense: 100, imageLicenseUrl: 2000
};
// The editor form doesn't send these; when missing, the article's existing values are kept.
const OPTIONAL_FIELDS = ['imageAlt', 'imageCredit', 'imageSourceUrl', 'imageLicense', 'imageLicenseUrl'];
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

// Fields needed for the workspace list. The full body is NOT loaded, keeping the list light.
const LIST_FIELDS = 'authorId workingCopy.title workingCopy.summary workingCopy.category ' +
  'workingCopy.imageUrl workingCopy.imageAlt publishedVersion.title publishedVersion.imageUrl ' +
  'publishedVersion.imageAlt workflowStatus editorNote';

// ===== Reading ===================================================================

// Workspace list: editors see every article, reporters only their own.
// Supports ?status=pending, ?q=<title search> and ?page=2 (20 per page).
async function listArticles(user, query = {}) {
  const filter = user.role === 'editor' ? {} : { authorId: user._id };
  const { status = '', page = '1' } = query;
  if (typeof status !== 'string' || (status && !Object.hasOwn(STATUS_LABELS, status)) || !isPageNumber(page)) {
    throw new HttpError(400, 'INVALID_FILTER', 'מצב הכתבה או מספר העמוד אינם תקינים');
  }
  if (status) filter.workflowStatus = status;
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 100) {
      throw new HttpError(400, 'INVALID_SEARCH', 'חיפוש לא תקין');
    }
    if (query.q.trim()) filter['workingCopy.title'] = containsText(query.q.trim());
  }

  const pageNumber = Number(page);
  // One extra item tells us whether there is a next page.
  const articles = await Article.find(filter)
    .select(LIST_FIELDS)
    .sort({ updatedAt: -1, _id: -1 })
    .skip((pageNumber - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE + 1)
    .populate('authorId', 'displayName')
    .lean();

  const pageArticles = articles.slice(0, PAGE_SIZE).map((article) => ({
    ...article,
    imageUrl: article.workingCopy?.imageUrl || article.publishedVersion?.imageUrl || '',
    imageAlt: article.workingCopy?.imageAlt || article.publishedVersion?.imageAlt ||
      article.workingCopy?.title || article.publishedVersion?.title || ''
  }));
  return { articles: pageArticles, nextPage: articles.length > PAGE_SIZE ? pageNumber + 1 : null };
}

// Loads one article and checks ownership: a reporter may only open their own articles.
async function getArticle(id, user) {
  if (!isObjectId(id)) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  const article = await Article.findById(id);
  if (!article) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  if (user.role !== 'editor' && String(article.authorId) !== String(user._id)) {
    throw new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לגשת לכתבה זו');
  }
  return article;
}

// ===== Validation ================================================================

// Validates the content sent by the editor form and returns a clean object.
function parseContent(input, existingContent = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !Object.hasOwn(CONTENT_LIMITS, key))) {
    throw new HttpError(400, 'INVALID_CONTENT', 'יש לשלוח שדות תוכן בלבד');
  }
  const content = {};
  for (const [key, limit] of Object.entries(CONTENT_LIMITS)) {
    if (input[key] === undefined && OPTIONAL_FIELDS.includes(key)) {
      content[key] = existingContent[key] || '';
      continue;
    }
    if (typeof input[key] !== 'string' || input[key].length > limit) {
      throw new HttpError(400, 'INVALID_CONTENT', 'תוכן הכתבה אינו תקין');
    }
    content[key] = input[key].trim();
  }
  if (!Object.hasOwn(Article.CATEGORIES, content.category)) {
    throw new HttpError(400, 'INVALID_CATEGORY', 'יש לבחור קטגוריה תקינה');
  }
  // Only http(s) links are allowed, which blocks "javascript:" URLs in <img src>.
  if (content.imageUrl && !HTTP_URL.test(content.imageUrl) && !ARTICLE_IMAGE_PATTERN.test(content.imageUrl)) {
    throw new HttpError(400, 'INVALID_IMAGE', 'יש להזין כתובת תמונה שמתחילה ב-http או https');
  }
  for (const field of ['imageSourceUrl', 'imageLicenseUrl']) {
    if (content[field] && !HTTP_URL.test(content[field])) {
      throw new HttpError(400, 'INVALID_IMAGE_ATTRIBUTION', 'קישורי מקור ורישיון חייבים להתחיל ב-http או https');
    }
  }
  return content;
}

// Two articles may not share a title. The match ignores case and extra spaces
// ("Breaking  news" == "breaking news") and checks both working and published titles.
async function ensureUniqueTitle(title, articleId) {
  const normalizedTitle = title.trim().replace(/\s+/g, ' ');
  if (!normalizedTitle) return; // empty drafts are allowed

  const words = normalizedTitle.split(' ').map(escapeRegex);
  const titlePattern = `^\\s*${words.join('\\s+')}\\s*$`;
  const filter = {
    $or: [
      { 'workingCopy.title': { $regex: titlePattern, $options: 'i' } },
      { 'publishedVersion.title': { $regex: titlePattern, $options: 'i' } }
    ]
  };
  if (articleId) filter._id = { $ne: articleId }; // ignore the article being edited

  const duplicate = await Article.findOne(filter).select('_id').lean();
  if (duplicate) {
    throw new HttpError(409, 'DUPLICATE_TITLE', 'כבר קיימת כתבה עם כותרת זהה. יש לבחור כותרת אחרת.');
  }
}

// Submitting or publishing needs every main field filled in (drafts may be incomplete).
function requireCompleteContent(content) {
  if (!content.title.trim() || !content.summary.trim() || !content.body.trim() || !content.category) {
    throw new HttpError(400, 'INCOMPLETE_ARTICLE', 'יש למלא כותרת, תקציר, תוכן וקטגוריה לפני הגשה או פרסום');
  }
}

function requireEditor(user) {
  if (user.role !== 'editor') throw new HttpError(403, 'FORBIDDEN', 'פעולה זו מותרת לעורך בלבד');
}

// ===== Creating and saving =======================================================

// Creates a new draft owned by the logged-in user (POST /api/staff/articles).
// `id` is optional: autosave passes the id that the browser generated.
async function createArticle(user, input, id) {
  const content = parseContent(input);
  await ensureUniqueTitle(content.title);
  // authorId comes from the session, never from the request body.
  const data = { authorId: user._id, workingCopy: content };
  if (id) data._id = id;
  const article = await Article.create(data);
  logger.info(`[articles] created ${article._id} by ${user._id}`);
  return article;
}

// Saves new content into workingCopy (PATCH /api/staff/articles/:id).
async function updateArticle(id, user, input) {
  const article = await getArticle(id, user);
  // While waiting for review the reporter can't change the content the editor is reviewing.
  if (user.role === 'reporter' && article.workflowStatus === 'pending') {
    throw new HttpError(409, 'AWAITING_REVIEW', 'לא ניתן לערוך כתבה שממתינה לאישור עורך');
  }
  const content = parseContent(input, article.workingCopy);
  await ensureUniqueTitle(content.title, article._id);
  article.workingCopy = content;
  // Editing a published article starts a new draft. publishedVersion is NOT touched,
  // so readers keep seeing the approved version until the next approval.
  if (article.workflowStatus === 'published') article.workflowStatus = 'draft';
  article.revision += 1;
  await article.save();
  return article;
}

// Autosave (PUT /api/staff/articles/:id).
// The browser generates the id of a new article itself, so the first autosave creates it
// and every later autosave updates it. Retrying the same request can never create duplicates.
async function saveDraft(id, user, input) {
  if (!isObjectId(id)) throw new HttpError(400, 'INVALID_ID', 'מזהה טיוטה לא תקין');
  if (await Article.findById(id)) return updateArticle(id, user, input);
  try {
    return await createArticle(user, input, id);
  } catch (err) {
    // Two autosaves raced to create the same new article: the other one won, so update it.
    if (err.code !== 11000) throw err;
    return updateArticle(id, user, input);
  }
}

// ===== Workflow transitions ======================================================

async function saveTransition(article, user, action) {
  article.revision += 1;
  await article.save();
  logger.info(`[articles] ${action} ${article._id} by ${user._id}`); // operational log
  return article;
}

// draft/returned -> pending. A reporter may submit only their own articles (checked by
// getArticle); an editor may submit any article, e.g. after editing it themselves.
async function submitArticle(id, user) {
  const article = await getArticle(id, user);
  await ensureUniqueTitle(article.workingCopy.title, article._id);
  if (!['draft', 'returned'].includes(article.workflowStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', 'ניתן להגיש רק טיוטה או כתבה שהוחזרה לתיקונים');
  }
  requireCompleteContent(article.workingCopy);
  article.workflowStatus = 'pending';
  article.editorNote = '';
  return saveTransition(article, user, 'submit');
}

// Editor: pending -> published. Copies workingCopy into a new publishedVersion.
async function approveArticle(id, user) {
  const article = await getArticle(id, user);
  requireEditor(user);
  if (article.workflowStatus !== 'pending') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'ניתן לפרסם רק כתבה שממתינה לאישור עורך');
  }
  await ensureUniqueTitle(article.workingCopy.title, article._id);
  requireCompleteContent(article.workingCopy);

  const publishedAt = new Date();
  const version = (article.publishedVersion?.version || 0) + 1;
  article.publishedVersion = { ...article.workingCopy.toObject(), version, publishedAt };
  // Recorded for the Impact Analytics graph ("update published here").
  article.publicationHistory.push({ version, publishedAt, editorId: user._id });
  article.workflowStatus = 'published';
  article.editorNote = '';
  return saveTransition(article, user, 'approve');
}

// Editor: pending -> returned, with a required note explaining what to fix.
async function returnArticle(id, user, note) {
  const article = await getArticle(id, user);
  requireEditor(user);
  if (article.workflowStatus !== 'pending') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'ניתן להחזיר רק כתבה שממתינה לאישור');
  }
  if (typeof note !== 'string' || !note.trim() || note.length > 1000) {
    throw new HttpError(400, 'NOTE_REQUIRED', 'יש לצרף הערה לתיקונים (עד 1000 תווים)');
  }
  article.workflowStatus = 'returned';
  article.editorNote = note.trim();
  return saveTransition(article, user, 'return');
}

// Editor: deletes an article together with its comments and view statistics.
async function deleteArticle(id, user) {
  requireEditor(user);
  const article = await getArticle(id, user);
  await article.deleteOne();
  logger.info(`[articles] deleted ${article._id} by ${user._id}`);
  await Promise.all([
    Comment.deleteMany({ articleId: article._id }),
    ArticleSeen.deleteMany({ articleId: article._id }),
    ViewStats.deleteMany({ articleId: article._id })
  ]);
}

module.exports = {
  STATUS_LABELS,
  listArticles,
  getArticle,
  createArticle,
  updateArticle,
  saveDraft,
  submitArticle,
  approveArticle,
  returnArticle,
  deleteArticle
};
