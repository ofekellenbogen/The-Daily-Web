const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const Article = require('../../src/models/Article');
const ViewStats = require('../../src/models/ViewStats');
const service = require('../../src/services/analytics.service');
const views = require('../../src/services/viewTracking.service');
const auth = require('../../src/services/auth.service');
const app = require('../../app');

const id = '507f1f77bcf86cd799439011';
let server;
let baseUrl;
function queryResult(value) {
  return { select() { return this; }, sort() { return this; }, skip() { return this; },
    limit() { return this; }, async lean() { return value; } };
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  mock.method(auth, 'findSession', async (token) => token === 'editor' || token === 'reporter'
    ? { userId: { _id: id, role: token, displayName: token } } : null);
});
afterEach(() => mock.restoreAll());
after(async () => {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
});

function request(path, role, headers = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: {
    ...(role ? { Cookie: `${auth.COOKIE_NAME}=${role}` } : {}), ...headers
  } });
}

test('fills empty buckets and aligns views with multiple publication events', async () => {
  mock.method(Article, 'findOne', () => queryResult({ publishedVersion: { title: 'News' }, publicationHistory: [
    { version: 1, publishedAt: new Date('2026-10-20T00:00:00Z') },
    { version: 2, publishedAt: new Date('2026-10-20T00:07:00Z') },
    { version: 3, publishedAt: new Date('2026-10-20T00:15:00Z') },
    { version: 4, publishedAt: new Date('2026-10-21T00:00:00Z') }
  ] }));
  mock.method(ViewStats, 'find', (filter) => {
    assert.equal(filter.articleId, id);
    assert.equal(filter.dayUtc.$lt.toISOString(), '2026-10-21T00:00:00.000Z');
    return queryResult([{ dayUtc: new Date('2026-10-20'), buckets: { 0: 2, 1: 8, 3: 15, 287: 1 } }]);
  });
  const result = await service.getAnalytics(id, { start: '2026-10-20', end: '2026-10-20' });
  assert.equal(result.points.length, 288);
  assert.equal(result.intervalMinutes, 5);
  assert.deepEqual(result.points.slice(0, 4).map((point) => point.views), [2, 8, 0, 15]);
  assert.equal(result.total, 26);
  assert.deepEqual(result.publications.map((event) => event.version), [1, 2, 3]);
  assert.equal(result.publications[1].publishedAt, '2026-10-20T00:07:00.000Z');
});

test('rejects invalid ids and invalid, reversed or oversized date ranges before querying', async () => {
  const find = mock.method(Article, 'findOne', () => { throw new Error('Unexpected database query'); });
  await assert.rejects(service.getAnalytics('bad'), { status: 404 });
  for (const range of [
    { start: '2026-02-30' }, { start: ['2026-10-20'] }, { end: 'invalid' },
    { start: '2026-10-21', end: '2026-10-20' }, { start: '2026-01-01', end: '2026-02-01' }
  ]) await assert.rejects(service.getAnalytics(id, range), { status: 400 });
  assert.equal(find.mock.callCount(), 0);
});

test('aggregates hourly across UTC days and supports empty data and Map buckets', async () => {
  mock.method(Article, 'findOne', () => queryResult({ publishedVersion: { title: 'News' }, publicationHistory: [] }));
  const find = mock.method(ViewStats, 'find', () => queryResult([
    { dayUtc: new Date('2026-10-20'), buckets: new Map([['0', 4], ['11', 6], ['12', 7]]) },
    { dayUtc: new Date('2026-10-21'), buckets: { 0: 3 } }
  ]));
  const range = { start: '2026-10-20', end: '2026-10-21' };
  const result = await service.getAnalytics(id, range);
  assert.equal(result.points.length, 48);
  assert.equal(result.points[0].views, 10);
  assert.equal(result.points[1].views, 7);
  assert.equal(result.points[24].views, 3);
  assert.equal(result.total, 20);
  find.mock.mockImplementation(() => queryResult([]));
  assert.equal((await service.getAnalytics(id, range)).total, 0);
});

test('missing or unpublished articles return 404', async () => {
  mock.method(Article, 'findOne', (filter) => {
    assert.deepEqual(filter.publishedVersion, { $ne: null });
    return queryResult(null);
  });
  await assert.rejects(service.getAnalytics(id), { status: 404 });
});

test('article selection is published-only and paginated, without article bodies', async () => {
  const items = Array.from({ length: 21 }, (_, index) => ({ _id: String(index), publishedVersion: { title: `News ${index}` } }));
  const find = mock.method(Article, 'find', (filter) => {
    assert.deepEqual(filter, { publishedVersion: { $ne: null } });
    const query = queryResult(items);
    query.skip = (offset) => { assert.equal(offset, 20); return query; };
    query.limit = (limit) => { assert.equal(limit, 21); return query; };
    query.select = (fields) => { assert.equal(fields, 'publishedVersion.title'); return query; };
    return query;
  });
  const result = await service.listArticles({ page: '2' });
  assert.equal(result.articles.length, 20);
  assert.deepEqual(result.articles[0], { id: '0', title: 'News 0' });
  assert.equal(result.nextPage, 3);
  for (const page of ['0', '-1', '1.5', ['1'], '1000000']) {
    await assert.rejects(service.listArticles({ page }), { status: 400 });
  }
  assert.equal(find.mock.callCount(), 1);
});

test('article search matches literal published titles and keeps queries bounded and newest-first', async () => {
  const find = mock.method(Article, 'find', (filter) => {
    assert.deepEqual(filter, { publishedVersion: { $ne: null },
      'publishedVersion.title': { $regex: 'News \\[2026\\]\\.\\*', $options: 'i' } });
    const query = queryResult([]);
    query.sort = (sort) => { assert.deepEqual(sort, { 'publishedVersion.publishedAt': -1, _id: -1 }); return query; };
    query.limit = (limit) => { assert.equal(limit, 21); return query; };
    return query;
  });
  assert.deepEqual(await service.listArticles({ q: '  News [2026].*  ' }), { articles: [], nextPage: null });
  for (const q of [['News'], { title: 'News' }, 'x'.repeat(101)]) {
    await assert.rejects(service.listArticles({ q }), { status: 400, code: 'INVALID_SEARCH' });
  }
  assert.equal(find.mock.callCount(), 1);
});

test('analytics pages and APIs reject guests, reporters and cross-origin requests', async () => {
  for (const path of ['/editor/analytics', '/api/analytics/articles', '/api/analytics/overview', `/api/analytics/articles/${id}`]) {
    const guest = await request(path);
    assert.equal(guest.status, path.startsWith('/api/') ? 401 : 302);
    assert.equal((await request(path, 'reporter')).status, 403);
  }
  assert.equal((await request('/api/analytics/articles', 'editor', { Origin: 'https://other.example' })).status, 403);
});

test('editors get the rendered dashboard, local chart library and REST data', async () => {
  const page = await request('/editor/analytics', 'editor');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /lang="he" dir="rtl"/);
  assert.match(html, /<h1>סטטיסטיקות<\/h1>/);
  assert.match(html, /href="\/editor\/analytics">סטטיסטיקות<\/a>/);
  assert.doesNotMatch(html, /analytics-more|טעינת כתבות נוספות/);
  assert.doesNotMatch(html, /<table|analytics-rows|analytics-data/);
  assert.match(html, /type="search" role="combobox"/);
  assert.match(html, /<canvas id="analytics-chart"/);
  assert.match(html, /src="\/vendor\/chart.js"/);
  assert.equal((await request('/vendor/chart.js')).status, 200);
  const list = mock.method(service, 'listArticles', async () => ({ articles: [{ id, title: 'News' }], nextPage: null }));
  const articles = await request('/api/analytics/articles?page=2&q=News', 'editor');
  assert.equal(articles.status, 200);
  assert.equal(articles.headers.get('cache-control'), 'no-store');
  assert.equal((await articles.json()).articles[0].id, id);
  assert.equal(list.mock.calls[0].arguments[0].page, '2');
  assert.equal(list.mock.calls[0].arguments[0].q, 'News');
  mock.method(Article, 'findOne', () => queryResult({ publishedVersion: { title: 'News' }, publicationHistory: [] }));
  mock.method(ViewStats, 'find', () => queryResult([]));
  const response = await request(`/api/analytics/articles/${id}?start=2026-10-20&end=2026-10-20`, 'editor');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).points.length, 288);
  assert.equal((await request(`/api/analytics/articles/${id}?start=bad`, 'editor')).status, 400);
  assert.equal((await request('/api/analytics/articles/bad', 'editor')).status, 404);
});

test('every concurrent visit uses one atomic daily and bucket increment', async () => {
  let total = 0;
  let bucket = 0;
  mock.method(ViewStats, 'updateOne', async (filter, update, options) => {
    assert.equal(filter.articleId, id);
    assert.equal(filter.dayUtc.toISOString(), '2026-10-20T00:00:00.000Z');
    assert.deepEqual(options, { upsert: true });
    assert.deepEqual(update, { $inc: { total: 1, 'buckets.1': 1 } });
    total += update.$inc.total;
    bucket += update.$inc['buckets.1'];
  });
  await Promise.all(Array.from({ length: 2000 }, () => views.recordView(id, new Date('2026-10-20T00:07:00Z'))));
  assert.equal(total, 2000);
  assert.equal(bucket, total);
});

test('a first-view unique-index race retries the atomic upsert once', async () => {
  let attempts = 0;
  const update = mock.method(ViewStats, 'updateOne', async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('duplicate'), { code: 11000 });
    return { acknowledged: true };
  });
  await views.recordView(id);
  assert.equal(update.mock.callCount(), 2);
  update.mock.mockImplementation(async () => { throw new Error('database unavailable'); });
  await assert.rejects(views.recordView(id), /database unavailable/);
  assert.equal(update.mock.callCount(), 3);
});

test('overview combines article buckets and includes every workflow state', async () => {
  mock.method(Article, 'aggregate', async () => [
    { _id: 'draft', count: 2, publications: 0 },
    { _id: 'published', count: 3, publications: 4 }
  ]);
  mock.method(ViewStats, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.dayUtc.$gte.toISOString(), '2026-10-20T00:00:00.000Z');
    return [
      { _id: { day: new Date('2026-10-20'), slot: '0' }, count: 12 },
      { _id: { day: new Date('2026-10-20'), slot: '12' }, count: 5 }
    ];
  });
  const result = await service.getOverview({ start: '2026-10-20', end: '2026-10-20' });
  assert.deepEqual(result.counts, { draft: 2, pending: 0, published: 3, returned: 0 });
  assert.equal(result.articleCount, 5);
  assert.equal(result.publicationCount, 4);
  assert.equal(result.total, 17);
  assert.equal(result.points.length, 288);
  const response = await request('/api/analytics/overview?start=2026-10-20&end=2026-10-20', 'editor');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).total, 17);
});

test('overview validates dates before querying and returns zero for empty data', async () => {
  const articles = mock.method(Article, 'aggregate', async () => []);
  mock.method(ViewStats, 'aggregate', async () => []);
  await assert.rejects(service.getOverview({ start: 'bad' }), { status: 400 });
  assert.equal(articles.mock.callCount(), 0);
  const result = await service.getOverview({ start: '2026-10-20', end: '2026-10-21' });
  assert.equal(result.articleCount, 0);
  assert.equal(result.total, 0);
  assert.equal(result.points.length, 48);
});
