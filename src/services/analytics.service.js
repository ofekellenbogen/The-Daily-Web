// Impact Analytics: data for the "views over time" graph that editors see.
//
// The graph shows, for one article and a date range (1-31 days):
//   - points:       how many views happened in each time interval
//   - publications: when an editor approved a version, drawn as vertical markers,
//                   so you can compare the views before and after each update.
const Article = require('../models/Article');
const ViewStats = require('../models/ViewStats');
const HttpError = require('../utils/HttpError');
const { PAGE_SIZE, isObjectId, isPageNumber, containsText } = require('../utils/validation');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000; // matches the 5-minute buckets in ViewStats
const SLOTS_PER_DAY = 288;
const MAX_RANGE_DAYS = 31;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// "2026-02-30" passes the pattern but isn't a real date, so we also check it round-trips.
function isValidDate(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Reads ?start=YYYY-MM-DD&end=YYYY-MM-DD (default: the last 7 days) and returns
// the range as timestamps: [from, until), where `until` is the end of the last day.
function parseRange(query, now) {
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(Date.parse(today) - 6 * DAY_MS).toISOString().slice(0, 10);
  const { start = weekAgo, end = today } = query;
  if (!isValidDate(start) || !isValidDate(end)) {
    throw new HttpError(400, 'INVALID_RANGE', 'יש לבחור תאריכים תקינים');
  }
  const from = Date.parse(start);
  const until = Date.parse(end) + DAY_MS;
  if (until <= from || until - from > MAX_RANGE_DAYS * DAY_MS) {
    throw new HttpError(400, 'INVALID_RANGE', 'יש לבחור טווח של יום אחד עד 31 ימים');
  }
  return { from, until, start, end };
}

// The article picker: published articles whose title contains `q`, 20 at a time.
async function listArticles(query = {}) {
  const { page = '1', q = '' } = query;
  if (!isPageNumber(page)) {
    throw new HttpError(400, 'INVALID_PAGE', 'מספר העמוד אינו תקין');
  }
  if (typeof q !== 'string' || q.length > 100) {
    throw new HttpError(400, 'INVALID_SEARCH', 'יש להזין חיפוש באורך עד 100 תווים');
  }
  const filter = { publishedVersion: { $ne: null } };
  if (q.trim()) filter['publishedVersion.title'] = containsText(q.trim());

  const articles = await Article.find(filter)
    .select('publishedVersion.title')
    .sort({ 'publishedVersion.publishedAt': -1, _id: -1 })
    .skip((Number(page) - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE + 1)
    .lean();
  return {
    articles: articles.slice(0, PAGE_SIZE).map((article) => ({ id: article._id, title: article.publishedVersion.title })),
    nextPage: articles.length > PAGE_SIZE ? Number(page) + 1 : null
  };
}

// Shared UTC buckets keep overview and individual reports aligned.
function buildPoints(stats, range) {
  // A single day is shown in 5-minute points; longer ranges are grouped into hourly points
  // (31 days * 288 slots would be too many points to draw clearly).
  const intervalMs = range.until - range.from <= DAY_MS ? BUCKET_MS : HOUR_MS;

  // Start with every point at 0 views, so hours without views still appear on the graph.
  const pointCount = (range.until - range.from) / intervalMs;
  const points = Array.from({ length: pointCount }, (_, index) => ({
    time: new Date(range.from + index * intervalMs).toISOString(),
    views: 0
  }));

  // Add each stored bucket's views to the point its time falls into.
  for (const stat of stats) {
    const buckets = stat.buckets instanceof Map ? stat.buckets.entries() : Object.entries(stat.buckets || {});
    for (const [slot, count] of buckets) {
      // Skip corrupted data instead of failing the whole graph.
      if (!/^\d+$/.test(slot) || Number(slot) >= SLOTS_PER_DAY || !Number.isFinite(count) || count < 0) continue;
      const timestamp = new Date(stat.dayUtc).getTime() + Number(slot) * BUCKET_MS;
      const index = Math.floor((timestamp - range.from) / intervalMs);
      if (points[index]) points[index].views += count;
    }
  }

  return { points, intervalMs };
}

// Aggregate in MongoDB so the response stays bounded even with many articles.
async function getOverview(query = {}, now = new Date()) {
  const range = parseRange(query, now);
  const [states, buckets] = await Promise.all([
    Article.aggregate([
      { $group: { _id: '$workflowStatus', count: { $sum: 1 }, publications: { $sum: {
        $size: { $filter: { input: '$publicationHistory', as: 'event', cond: { $and: [
          { $gte: ['$$event.publishedAt', new Date(range.from)] },
          { $lt: ['$$event.publishedAt', new Date(range.until)] }
        ] } } }
      } } } }
    ]),
    ViewStats.aggregate([
      { $match: { dayUtc: { $gte: new Date(range.from), $lt: new Date(range.until) } } },
      { $project: { dayUtc: 1, buckets: { $objectToArray: '$buckets' } } },
      { $unwind: '$buckets' },
      { $match: { 'buckets.k': { $regex: '^\\d+$' }, 'buckets.v': { $gte: 0 } } },
      { $group: { _id: { day: '$dayUtc', slot: '$buckets.k' }, count: { $sum: '$buckets.v' } } }
    ])
  ]);
  const counts = Object.fromEntries(Article.WORKFLOW_STATUSES.map((state) => [state, 0]));
  for (const state of states) if (Object.hasOwn(counts, state._id)) counts[state._id] = state.count;
  const { points, intervalMs } = buildPoints(buckets.map((bucket) => ({
    dayUtc: bucket._id.day, buckets: { [bucket._id.slot]: bucket.count }
  })), range);
  return {
    article: null, counts, articleCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
    publicationCount: states.reduce((sum, state) => sum + state.publications, 0),
    start: range.start, end: range.end, intervalMinutes: intervalMs / 60000,
    total: points.reduce((sum, point) => sum + point.views, 0), points, publications: []
  };
}

// Builds the graph data for one article (GET /api/analytics/articles/:id?start=...&end=...).
async function getAnalytics(id, query = {}, now = new Date()) {
  if (!isObjectId(id)) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');
  const range = parseRange(query, now);
  const article = await Article.findOne({ _id: id, publishedVersion: { $ne: null } })
    .select('publishedVersion.title publicationHistory').lean();
  if (!article) throw new HttpError(404, 'NOT_FOUND', 'הכתבה לא נמצאה');

  // One ViewStats document per day in the range.
  const stats = await ViewStats.find({
    articleId: id,
    dayUtc: { $gte: new Date(range.from), $lt: new Date(range.until) }
  }).select('dayUtc buckets').sort({ dayUtc: 1 }).lean();

  const { points, intervalMs } = buildPoints(stats, range);

  // Approval moments inside the range, oldest first.
  const publications = article.publicationHistory
    .filter((event) => {
      const time = new Date(event.publishedAt).getTime();
      return time >= range.from && time < range.until;
    })
    .map((event) => ({ version: event.version, publishedAt: new Date(event.publishedAt).toISOString() }))
    .sort((first, second) => first.publishedAt.localeCompare(second.publishedAt));

  return {
    article: { id, title: article.publishedVersion.title },
    start: range.start,
    end: range.end,
    intervalMinutes: intervalMs / 60000,
    total: points.reduce((sum, point) => sum + point.views, 0),
    points,
    publications
  };
}

module.exports = { listArticles, getAnalytics, getOverview };
