// The public news feed on the home page: search, filter, sort and infinite scroll.
// The browser calls GET /api/articles with query parameters, for example:
//   /api/articles?q=election&category=politics&seen=unseen&sort=popularity&cursor=...
const crypto = require('crypto');
const mongoose = require('mongoose');
const Article = require('../models/Article');
const HttpError = require('../utils/HttpError');
const { PAGE_SIZE, isObjectId, escapeRegex, containsText } = require('../utils/validation');
const viewTracking = require('./viewTracking.service');
const { getArticleMedia } = require('./articleImage.service');

const { CATEGORIES } = Article;

const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 100;
const SEEN_OPTIONS = ['all', 'seen', 'unseen'];
const SORT_OPTIONS = ['date', 'popularity'];
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS = 500;

// Only published fields are loaded, so drafts can never leak to the public feed.
const CARD_FIELDS = [
  'authorId',
  'publishedVersion.title',
  'publishedVersion.summary',
  'publishedVersion.category',
  'publishedVersion.imageUrl',
  'publishedVersion.imageAlt',
  'publishedVersion.imageCredit',
  'publishedVersion.imageSourceUrl',
  'publishedVersion.imageLicense',
  'publishedVersion.imageLicenseUrl',
  'publishedVersion.publishedAt'
].join(' ');

const DATE_SORT = { 'publishedVersion.publishedAt': -1, _id: -1 };

// Validates the query string. Invalid values return 400 with a message per field.
function parseFeedQuery(query) {
  const fields = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length > MAX_QUERY_LENGTH) fields.q = `החיפוש מוגבל ל-${MAX_QUERY_LENGTH} תווים`;

  const category = typeof query.category === 'string' ? query.category : '';
  if (category && !Object.hasOwn(CATEGORIES, category)) fields.category = 'קטגוריה לא קיימת';

  const seen = query.seen ?? 'all';
  if (!SEEN_OPTIONS.includes(seen)) fields.seen = 'ערך סינון לא תקין';

  const sort = query.sort ?? 'date';
  if (!SORT_OPTIONS.includes(sort)) fields.sort = 'ערך מיון לא תקין';

  let limit = PAGE_SIZE;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      fields.limit = `מספר בין 1 ל-${MAX_LIMIT}`;
    }
  }

  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null;

  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'פרמטרים לא תקינים', fields);
  }
  return { q, category, seen, sort, limit, cursor };
}

// Builds the MongoDB filter from search + category + seen/unseen.
async function buildFilter({ q, category, seen }, deviceId) {
  const filter = { 'publishedVersion.publishedAt': { $ne: null } }; // published articles only
  if (q) filter['publishedVersion.title'] = containsText(q); // search by title
  if (category) filter['publishedVersion.category'] = category;
  if (seen !== 'all') {
    const seenIds = await viewTracking.getSeenArticleIds(deviceId);
    filter._id = seen === 'seen' ? { $in: seenIds } : { $nin: seenIds };
  }
  return filter;
}

function findCards(filter) {
  return Article.find(filter).select(CARD_FIELDS).populate('authorId', 'displayName').lean();
}

// --- Sort by date: cursor pagination ---------------------------------------------
// The cursor remembers the last card shown ("<publishedAt>|<_id>" in base64), and the
// next page asks for articles older than it. Unlike skip(), this stays fast with
// thousands of articles because it uses the publishedAt index.

function invalidCursor() {
  return new HttpError(400, 'INVALID_CURSOR', 'מצביע דפדוף לא תקין', { cursor: 'invalid' });
}

function encodeDateCursor(article) {
  const value = `${article.publishedVersion.publishedAt.toISOString()}|${article._id}`;
  return Buffer.from(value).toString('base64url');
}

function decodeDateCursor(cursor) {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(iso);
  if (!isObjectId(id) || Number.isNaN(date.getTime())) throw invalidCursor();
  return { date, id: new mongoose.Types.ObjectId(id) };
}

async function getDatePage(filter, cursor, limit) {
  const query = { ...filter };
  if (cursor) {
    const { date, id } = decodeDateCursor(cursor);
    // Two articles can share a publish time, so _id breaks the tie.
    query.$or = [
      { 'publishedVersion.publishedAt': { $lt: date } },
      { 'publishedVersion.publishedAt': date, _id: { $lt: id } }
    ];
  }

  // One extra article tells us whether there is another page.
  const docs = await findCards(query).sort(DATE_SORT).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  return {
    page,
    hasMore,
    nextCursor: hasMore ? encodeDateCursor(page[page.length - 1]) : null
  };
}

// --- Sort by popularity: snapshot pagination -------------------------------------
// View counts change every second. If we re-sorted on every "load more", articles would
// jump between pages (duplicates / missing cards). So on the first page we save the
// ordered list of ids (a "snapshot") in memory for 10 minutes, and later pages read
// from it. The cursor is "<snapshotId>:<offset>".
const popularitySnapshots = new Map();

// Removes expired snapshots and caps memory use.
function pruneSnapshots() {
  const now = Date.now();
  for (const [id, snapshot] of popularitySnapshots) {
    if (snapshot.expiresAt < now) popularitySnapshots.delete(id);
  }
  while (popularitySnapshots.size >= MAX_SNAPSHOTS) {
    popularitySnapshots.delete(popularitySnapshots.keys().next().value); // oldest first
  }
}

async function createSnapshot(filter, key) {
  const docs = await Article.find(filter).select('_id').lean();
  const ids = docs.map((doc) => doc._id);
  const counts = await viewTracking.getPopularity();
  // Most views first; equal views fall back to newest id first.
  ids.sort((a, b) => {
    const diff = (counts.get(String(b)) || 0) - (counts.get(String(a)) || 0);
    return diff !== 0 ? diff : String(b).localeCompare(String(a));
  });

  pruneSnapshots();
  const snapshot = { id: crypto.randomUUID(), key, ids, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
  popularitySnapshots.set(snapshot.id, snapshot);
  return snapshot;
}

async function getPopularityPage(filter, params, deviceId) {
  // The key ties a snapshot to its search/filters, so a cursor can't be reused with other filters.
  const key = JSON.stringify([params.q, params.category, params.seen, deviceId]);
  let snapshot;
  let offset = 0;

  if (params.cursor) {
    const [snapshotId, offsetText] = params.cursor.split(':');
    offset = Number(offsetText);
    if (!snapshotId || !Number.isInteger(offset) || offset < 0) throw invalidCursor();

    snapshot = popularitySnapshots.get(snapshotId);
    if (!snapshot || snapshot.expiresAt < Date.now() || snapshot.key !== key) {
      throw new HttpError(409, 'CURSOR_EXPIRED', 'רשימת התוצאות פגה, יש לטעון אותה מחדש');
    }
  } else {
    snapshot = await createSnapshot(filter, key);
  }

  const ids = snapshot.ids.slice(offset, offset + params.limit);
  const docs = await findCards({ _id: { $in: ids }, 'publishedVersion.publishedAt': { $ne: null } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  // Keep the snapshot order; skip articles deleted or unpublished since the snapshot was taken.
  const page = ids.map((id) => byId.get(String(id))).filter(Boolean);

  const nextOffset = offset + ids.length;
  const hasMore = nextOffset < snapshot.ids.length;
  return { page, hasMore, nextCursor: hasMore ? `${snapshot.id}:${nextOffset}` : null };
}

// Turns a database document into the small object the feed card needs.
function toCard(doc) {
  const version = doc.publishedVersion;
  const media = getArticleMedia(version);
  return {
    id: String(doc._id),
    title: version.title,
    summary: version.summary,
    imageUrl: media.imageUrl,
    imageAlt: media.imageAlt,
    category: version.category,
    categoryLabel: CATEGORIES[version.category] || version.category,
    authorName: doc.authorId ? doc.authorId.displayName : 'מערכת החדשות',
    publishedAt: version.publishedAt.toISOString()
  };
}

// Main entry point used by GET /api/articles.
async function getFeed(rawQuery, deviceId) {
  const params = parseFeedQuery(rawQuery);
  const filter = await buildFilter(params, deviceId);

  const result =
    params.sort === 'popularity'
      ? await getPopularityPage(filter, params, deviceId)
      : await getDatePage(filter, params.cursor, params.limit);

  return {
    data: result.page.map(toCard),
    meta: { nextCursor: result.nextCursor, hasMore: result.hasMore, limit: params.limit }
  };
}

module.exports = { getFeed, parseFeedQuery, escapeRegex, encodeDateCursor, decodeDateCursor };
