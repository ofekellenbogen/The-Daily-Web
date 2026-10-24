const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Article = require('../../src/models/Article');
const {
  getFeed,
  parseFeedQuery,
  escapeRegex,
  encodeDateCursor,
  decodeDateCursor
} = require('../../src/modules/public/feed.service');
const { FALLBACK_IMAGE_URL } = require('../../src/modules/public/article-media');

test('public feed cards include accessible media and a fallback for legacy articles', async (t) => {
  const docs = [{
    _id: new mongoose.Types.ObjectId(),
    authorId: { displayName: 'Reporter' },
    publishedVersion: {
      title: 'Legacy article', summary: 'Summary', category: 'tech', imageUrl: '', imageAlt: '',
      publishedAt: new Date('2026-10-24T10:00:00.000Z')
    }
  }];
  const query = {
    select() { return this; },
    populate() { return this; },
    lean() { return this; },
    sort() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(docs).then(resolve, reject); }
  };
  t.mock.method(Article, 'find', (filter) => {
    assert.deepEqual(filter, { 'publishedVersion.publishedAt': { $ne: null } });
    return query;
  });

  const result = await getFeed({}, 'device-id');

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].imageUrl, FALLBACK_IMAGE_URL);
  assert.equal(result.data[0].imageAlt, '');
});

test('parseFeedQuery applies defaults', () => {
  assert.deepEqual(parseFeedQuery({}), {
    q: '',
    category: '',
    seen: 'all',
    sort: 'date',
    limit: 20,
    cursor: null
  });
});

test('parseFeedQuery trims the search text', () => {
  assert.equal(parseFeedQuery({ q: '  ספורט  ' }).q, 'ספורט');
});

test('parseFeedQuery rejects unknown values with field errors', () => {
  assert.throws(
    () => parseFeedQuery({ category: 'nope', seen: 'x', sort: 'y', limit: '500' }),
    (err) => {
      assert.equal(err.status, 400);
      assert.deepEqual(Object.keys(err.fields).sort(), ['category', 'limit', 'seen', 'sort']);
      return true;
    }
  );
});

test('parseFeedQuery rejects a search longer than 100 characters', () => {
  assert.throws(() => parseFeedQuery({ q: 'א'.repeat(101) }), { status: 400 });
});

test('parseFeedQuery rejects repeated parameters', () => {
  assert.throws(() => parseFeedQuery({ sort: ['date', 'popularity'] }), { status: 400 });
});

test('escapeRegex neutralizes regex syntax', () => {
  const pattern = new RegExp(escapeRegex('a.b*(c)'));
  assert.ok(pattern.test('a.b*(c)'));
  assert.ok(!pattern.test('axbbbc'));
});

test('date cursor round-trips', () => {
  const id = new mongoose.Types.ObjectId();
  const publishedAt = new Date('2026-10-01T12:30:00.000Z');
  const cursor = encodeDateCursor({ _id: id, publishedVersion: { publishedAt } });
  const decoded = decodeDateCursor(cursor);
  assert.equal(decoded.date.toISOString(), publishedAt.toISOString());
  assert.equal(String(decoded.id), String(id));
});

test('a tampered date cursor is rejected', () => {
  assert.throws(() => decodeDateCursor('not-a-cursor'), { status: 400, code: 'INVALID_CURSOR' });
});
