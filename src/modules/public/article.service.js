const Article = require('../../models/Article');
const { HttpError } = require('../../middleware/errors');
const { isObjectId } = require('../../utils/objectId');

const { CATEGORIES } = Article;

function articleNotFound() {
  return new HttpError(404, 'NOT_FOUND', 'הכתבה המבוקשת לא נמצאה');
}

function splitParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// Loads only the approved snapshot, so a draft or pending edit can never reach the page.
async function getPublicArticle(id) {
  if (!isObjectId(id)) throw articleNotFound();

  const doc = await Article.findOne({ _id: id, 'publishedVersion.publishedAt': { $ne: null } })
    .select('authorId publishedVersion')
    .populate('authorId', 'displayName')
    .lean();
  if (!doc) throw articleNotFound();

  const version = doc.publishedVersion;
  return {
    id: String(doc._id),
    title: version.title,
    summary: version.summary,
    paragraphs: splitParagraphs(version.body),
    imageUrl: version.imageUrl,
    category: version.category,
    categoryLabel: CATEGORIES[version.category] || version.category,
    authorName: doc.authorId ? doc.authorId.displayName : 'מערכת החדשות',
    publishedAt: version.publishedAt,
    isUpdate: version.version > 1
  };
}

module.exports = { getPublicArticle, splitParagraphs };
