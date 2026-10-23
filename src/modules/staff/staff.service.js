const Article = require('../../models/Article');
const Comment = require('../../models/Comment');
const ArticleSeen = require('../../models/ArticleSeen');
const ViewStats = require('../../models/ViewStats');
const { HttpError } = require('../../middleware/errors');
const { isObjectId } = require('../../utils/objectId');

const STATUS_LABELS = { draft: 'בהכנה', pending: 'ממתינה לאישור עורך', published: 'פורסמה', returned: 'הוחזרה לתיקונים' };

async function listArticles(user, query = {}) {
  const filter = user.role === 'editor' ? {} : { authorId: user._id };
  const { status = '', page = '1' } = query;
  if (typeof status !== 'string' || (status && !Object.hasOwn(STATUS_LABELS, status)) ||
      typeof page !== 'string' || !/^[1-9]\d{0,5}$/.test(page)) {
    throw new HttpError(400, 'INVALID_FILTER', 'מצב הכתבה או מספר העמוד אינם תקינים');
  }
  if (status) filter.workflowStatus = status;
  const pageNumber = Number(page);
  const articles = await Article.find(filter)
    .select('authorId workingCopy.title workflowStatus editorNote')
    .sort({ updatedAt: -1, _id: -1 }).skip((pageNumber - 1) * 20).limit(21)
    .populate('authorId', 'displayName').lean();
  return { articles: articles.slice(0, 20), nextPage: articles.length > 20 ? pageNumber + 1 : null };
}

async function getArticle(id, user) {
  if (!isObjectId(id)) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  const article = await Article.findById(id);
  if (!article) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  if (user.role !== 'editor' && String(article.authorId) !== String(user._id)) {
    throw new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לגשת לכתבה זו');
  }
  return article;
}

function parseContent(input) {
  const limits = { title: 200, summary: 1000, body: 50000, category: 30, imageUrl: 2000 };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !Object.hasOwn(limits, key))) {
    throw new HttpError(400, 'INVALID_CONTENT', 'יש לשלוח שדות תוכן בלבד');
  }
  const content = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || input[key].length > limit) {
      throw new HttpError(400, 'INVALID_CONTENT', 'תוכן הכתבה אינו תקין');
    }
    content[key] = input[key].trim();
  }
  if (!Object.hasOwn(Article.CATEGORIES, content.category)) {
    throw new HttpError(400, 'INVALID_CATEGORY', 'יש לבחור קטגוריה תקינה');
  }
  if (content.imageUrl && !/^https?:\/\/[^\s]+$/i.test(content.imageUrl)) {
    throw new HttpError(400, 'INVALID_IMAGE', 'יש להזין כתובת תמונה שמתחילה ב-http או https');
  }
  return content;
}

async function createArticle(user, input) {
  const article = await Article.create({ authorId: user._id, workingCopy: parseContent(input) });
  console.info(`[articles] created ${article._id} by ${user._id}`);
  return article;
}

async function updateArticle(id, user, input) {
  const article = await getArticle(id, user);
  if (user.role === 'reporter' && article.workflowStatus === 'pending') {
    throw new HttpError(409, 'AWAITING_REVIEW', 'לא ניתן לערוך כתבה שממתינה לאישור עורך');
  }
  article.workingCopy = parseContent(input);
  // Editing never changes the public snapshot, even for an editor.
  if (article.workflowStatus === 'published') article.workflowStatus = 'draft';
  article.revision += 1;
  await article.save();
  return article;
}

function requireCompleteContent(content) {
  if (!content.title.trim() || !content.summary.trim() || !content.body.trim() || !content.category) {
    throw new HttpError(400, 'INCOMPLETE_ARTICLE', 'יש למלא כותרת, תקציר, תוכן וקטגוריה לפני הגשה או פרסום');
  }
}

async function transitionArticle(id, user, action, note) {
  const article = await getArticle(id, user);
  if (action === 'submit') {
    if (!['draft', 'returned'].includes(article.workflowStatus)) {
      throw new HttpError(409, 'INVALID_TRANSITION', 'ניתן להגיש רק טיוטה או כתבה שהוחזרה לתיקונים');
    }
    requireCompleteContent(article.workingCopy);
    article.workflowStatus = 'pending';
    article.editorNote = '';
  } else {
    if (user.role !== 'editor') throw new HttpError(403, 'FORBIDDEN', 'פעולה זו מותרת לעורך בלבד');
    if (article.workflowStatus !== 'pending') {
      throw new HttpError(409, 'INVALID_TRANSITION', 'ניתן לאשר או להחזיר רק כתבה שממתינה לאישור');
    }
    if (action === 'approve') {
      requireCompleteContent(article.workingCopy);
      const publishedAt = new Date();
      const version = (article.publishedVersion?.version || 0) + 1;
      article.publishedVersion = { ...article.workingCopy.toObject(), version, publishedAt };
      article.publicationHistory.push({ version, publishedAt, editorId: user._id });
      article.workflowStatus = 'published';
      article.editorNote = '';
    } else if (action === 'return') {
      if (typeof note !== 'string' || !note.trim() || note.length > 1000) {
        throw new HttpError(400, 'NOTE_REQUIRED', 'יש לצרף הערה לתיקונים (עד 1000 תווים)');
      }
      article.workflowStatus = 'returned';
      article.editorNote = note.trim();
    } else {
      throw new HttpError(400, 'INVALID_ACTION', 'פעולה לא תקינה');
    }
  }
  article.revision += 1;
  await article.save();
  console.info(`[articles] ${action} ${article._id} by ${user._id}`);
  return article;
}

async function deleteArticle(id, user) {
  if (user.role !== 'editor') throw new HttpError(403, 'FORBIDDEN', 'פעולה זו מותרת לעורך בלבד');
  const article = await getArticle(id, user);
  await article.deleteOne();
  console.info(`[articles] deleted ${article._id} by ${user._id}`);
  await Promise.all([
    Comment.deleteMany({ articleId: article._id }),
    ArticleSeen.deleteMany({ articleId: article._id }),
    ViewStats.deleteMany({ articleId: article._id })
  ]);
}

async function saveDraft(id, user, input) {
  if (!isObjectId(id)) throw new HttpError(400, 'INVALID_ID', 'מזהה טיוטה לא תקין');
  const existing = await Article.findById(id);
  if (existing) return updateArticle(id, user, input);
  if (user.role !== 'reporter') throw new HttpError(403, 'FORBIDDEN', 'יצירת טיוטה מותרת לכתב בלבד');
  const content = parseContent(input);
  try {
    return await Article.create({ _id: id, authorId: user._id, workingCopy: content });
  } catch (err) {
    if (err.code !== 11000) throw err;
    return updateArticle(id, user, input);
  }
}

module.exports = { STATUS_LABELS, listArticles, getArticle, createArticle, updateArticle, transitionArticle, deleteArticle, saveDraft };
