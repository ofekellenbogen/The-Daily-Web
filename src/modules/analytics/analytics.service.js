const Article = require('../../models/Article');
const ViewStats = require('../../models/ViewStats');
const { HttpError } = require('../../middleware/errors');
const { isObjectId } = require('../../utils/objectId');

const DAY_MS = 86400000;
const BUCKET_MS = 300000;

function parseRange(query, now) {
  const today = now.toISOString().slice(0, 10);
  const startDefault = new Date(Date.parse(today) - 6 * DAY_MS).toISOString().slice(0, 10);
  const { start = startDefault, end = today } = query;
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end)) {
    throw new HttpError(400, 'INVALID_RANGE', 'יש לבחור תאריכים תקינים');
  }
  const from = Date.parse(start);
  const until = Date.parse(end) + DAY_MS;
  if (until <= from || until - from > 31 * DAY_MS) {
    throw new HttpError(400, 'INVALID_RANGE', 'יש לבחור טווח של יום אחד עד 31 ימים');
  }
  return { from, until, start, end };
}

async function listArticles(query = {}) {
  const { page = '1', q = '' } = query;
  if (typeof page !== 'string' || !/^[1-9]\d{0,5}$/.test(page)) {
    throw new HttpError(400, 'INVALID_PAGE', 'מספר העמוד אינו תקין');
  }
  if (typeof q !== 'string' || q.length > 100) {
    throw new HttpError(400, 'INVALID_SEARCH', 'יש להזין חיפוש באורך עד 100 תווים');
  }
  const filter = { publishedVersion: { $ne: null } };
  if (q.trim()) filter['publishedVersion.title'] = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const articles = await Article.find(filter)
    .select('publishedVersion.title').sort({ 'publishedVersion.publishedAt': -1, _id: -1 })
    .skip((Number(page) - 1) * 20).limit(21).lean();
  return { articles: articles.slice(0, 20).map((article) => ({ id: article._id, title: article.publishedVersion.title })),
    nextPage: articles.length > 20 ? Number(page) + 1 : null };
}

async function getAnalytics(id, query = {}, now = new Date()) {
  if (!isObjectId(id)) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  const range = parseRange(query, now);
  const article = await Article.findOne({ _id: id, publishedVersion: { $ne: null } })
    .select('publishedVersion.title publicationHistory').lean();
  if (!article) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  const stats = await ViewStats.find({ articleId: id,
    dayUtc: { $gte: new Date(range.from), $lt: new Date(range.until) } })
    .select('dayUtc buckets').sort({ dayUtc: 1 }).lean();
  const intervalMs = range.until - range.from <= DAY_MS ? BUCKET_MS : 3600000;
  const points = Array.from({ length: (range.until - range.from) / intervalMs }, (_, index) => ({
    time: new Date(range.from + index * intervalMs).toISOString(), views: 0
  }));
  for (const stat of stats) {
    const buckets = stat.buckets instanceof Map ? stat.buckets.entries() : Object.entries(stat.buckets || {});
    for (const [slot, count] of buckets) {
      if (!/^\d+$/.test(slot) || Number(slot) >= 288 || !Number.isFinite(count) || count < 0) continue;
      const timestamp = new Date(stat.dayUtc).getTime() + Number(slot) * BUCKET_MS;
      const index = Math.floor((timestamp - range.from) / intervalMs);
      if (points[index]) points[index].views += count;
    }
  }
  const publications = article.publicationHistory
    .filter((event) => new Date(event.publishedAt).getTime() >= range.from && new Date(event.publishedAt).getTime() < range.until)
    .map((event) => ({ version: event.version, publishedAt: new Date(event.publishedAt).toISOString() }))
    .sort((first, second) => first.publishedAt.localeCompare(second.publishedAt));
  return { article: { id, title: article.publishedVersion.title }, start: range.start, end: range.end,
    intervalMinutes: intervalMs / 60000, total: points.reduce((sum, point) => sum + point.views, 0), points, publications };
}

module.exports = { listArticles, getAnalytics };