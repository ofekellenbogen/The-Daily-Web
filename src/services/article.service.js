// Loads a single published article for the public article page.
const Article = require('../models/Article');
const HttpError = require('../utils/HttpError');
const { isObjectId } = require('../utils/validation');
const { getArticleMedia } = require('./articleImage.service');

const { CATEGORIES } = Article;

function articleNotFound() {
  return new HttpError(404, 'NOT_FOUND', 'הכתבה המבוקשת לא נמצאה');
}

// The body is plain text; an empty line between blocks starts a new paragraph (<p>).
function splitParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// Reads ONLY publishedVersion, so drafts or edits waiting for approval can never reach readers.
async function getPublicArticle(id) {
  if (!isObjectId(id)) throw articleNotFound();

  const doc = await Article.findOne({ _id: id, 'publishedVersion.publishedAt': { $ne: null } })
    // $slice: 1 loads only the first publication event (for "first published at").
    .select({ authorId: 1, publishedVersion: 1, publicationHistory: { $slice: 1 } })
    .populate('authorId', 'displayName') // replace the author's id with their name
    .lean(); // plain object instead of a Mongoose document (faster, read-only)
  if (!doc) throw articleNotFound();

  const version = doc.publishedVersion;
  return {
    id: String(doc._id),
    title: version.title,
    summary: version.summary,
    paragraphs: splitParagraphs(version.body),
    ...getArticleMedia(version),
    category: version.category,
    categoryLabel: CATEGORIES[version.category] || version.category,
    authorName: doc.authorId ? doc.authorId.displayName : 'מערכת החדשות',
    firstPublishedAt: doc.publicationHistory[0]?.publishedAt || version.publishedAt,
    publishedAt: version.publishedAt,
    isUpdate: version.version > 1
  };
}

module.exports = { getPublicArticle, splitParagraphs };
