const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const User = require('../../src/models/User');
const Comment = require('../../src/models/Comment');
const ViewStats = require('../../src/models/ViewStats');
const Article = require('../../src/models/Article');
const Session = require('../../src/models/Session');
const auth = require('../../src/modules/auth/auth.service');
const service = require('../../src/modules/admin/admin.service');
const { verifyPassword } = require('../../src/utils/password');
const app = require('../../app');
const actor = new User({ role: 'editor' });
const articleId = String(new Article()._id);
const stores = new Map();
let server, base, lastPipeline;
function query(value) {
  return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
    lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}
before(async () => {
  mock.method(auth, 'findSession', async token => ['editor', 'reporter'].includes(token) ? { userId: { _id: actor._id, role: token, displayName: 'Test' } } : null);
  mock.method(Article, 'exists', async filter => filter.authorId ? null : String(filter._id) === articleId ? { _id: articleId } : null);
  mock.method(Session, 'deleteMany', async () => ({}));
  for (const Model of [User, Comment, ViewStats]) {
    const rows = new Map(); stores.set(Model, rows);
    mock.method(Model, 'create', async input => {
      const doc = new Model(input); await doc.validate(); rows.set(String(doc._id), doc); return doc;
    });
    mock.method(Model, 'find', () => query([...rows.values()].map(row => row.toObject())));
    mock.method(Model, 'findById', id => query(rows.get(String(id))?.toObject() || null));
    mock.method(Model, 'findByIdAndUpdate', (id, update, options) => {
      const row = rows.get(String(id));
      if (row && Array.isArray(update)) {
        assert.equal(options.updatePipeline, true);
        lastPipeline = update;
        const [bucket, count] = Object.entries(update[0].$set).find(([name]) => name.startsWith('buckets.'));
        const slot = bucket.split('.')[1]; row.total += count - (row.buckets.get(slot) || 0); row.buckets.set(slot, count);
      } else if (row) Object.assign(row, update.$set);
      return query(row || null);
    });
    mock.method(Model, 'findByIdAndDelete', async id => {
      const row = rows.get(String(id)); rows.delete(String(id)); return row;
    });
  }
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
function request(path, method = 'GET', body, role = 'editor', headers = {}) {
  return fetch(`${base}${path}`, { method, redirect: 'manual', headers: { Cookie: `dw_session=${role}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test('users page and every CRUD method enforce editor access and same-origin protection', async () => {
  for (const role of ['guest', 'reporter']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      assert.equal((await request(`/api/admin/users${['PATCH', 'DELETE'].includes(method) ? `/${actor._id}` : ''}`, method, undefined, role)).status, role === 'guest' ? 401 : 403);
    }
    assert.equal((await request('/editor/data', 'GET', undefined, role)).status, role === 'guest' ? 302 : 403);
    assert.equal((await request('/editor/users', 'GET', undefined, role)).status, role === 'guest' ? 302 : 403);
  }
  const legacy = await request('/editor/data');
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get('location'), '/editor/users');
  const page = await request('/editor/users');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>ניהול משתמשים<\/title>/);
  assert.match(html, /<h1>ניהול משתמשים<\/h1>/);
  assert.doesNotMatch(html, /data-resource|ניהול נתונים|value="comments"|value="stats"/);
  assert.equal((await request('/api/admin/users', 'POST', {}, 'editor', { Origin: 'https://evil.example' })).status, 403);
});
test('users support create/read/list/update/delete without exposing password hashes', async () => {
  const input = { username: 'new.writer', displayName: 'Writer', role: 'reporter', password: 'example-password' };
  const created = await request('/api/admin/users', 'POST', input);
  assert.equal(created.status, 201);
  const body = await created.json(), id = body.data._id;
  assert.equal(body.data.passwordHash, undefined);
  assert.ok(await verifyPassword(input.password, stores.get(User).get(id).passwordHash));
  // Production projection is checked separately because this in-memory query does not project fields.
  assert.equal((await request(`/api/admin/users/${id}`)).status, 200);
  assert.equal((await request('/api/admin/users?q=writer')).status, 200);
  const updated = await request(`/api/admin/users/${id}`, 'PATCH', { ...input, displayName: 'Updated', password: '' });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).data.displayName, 'Updated');
  assert.equal((await request(`/api/admin/users/${id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/api/admin/users/${id}`)).status, 404);
  assert.equal((await request(`/api/admin/users/${actor._id}`, 'DELETE')).status, 409);
  assert.equal((await request(`/api/admin/users/${actor._id}`, 'PATCH', { ...input, role: 'reporter' })).status, 409);
});
test('comments support CRUD and reject invalid input and missing parent articles', async () => {
  const input = { articleId, authorName: 'Reader', body: 'Original' };
  const created = await request('/api/admin/comments', 'POST', input);
  assert.equal(created.status, 201);
  const { data } = await created.json(); assert.equal(data.deviceId, undefined);
  assert.equal((await request(`/api/admin/comments/${data._id}`)).status, 200);
  assert.equal((await request('/api/admin/comments?q=Original')).status, 200);
  const response = await request(`/api/admin/comments/${data._id}`, 'PATCH', { authorName: 'Reader', body: 'Corrected' });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.body, 'Corrected');
  assert.equal((await request(`/api/admin/comments/${data._id}`, 'DELETE')).status, 204);
  assert.equal((await request('/api/admin/comments', 'POST', { ...input, articleId: String(new Article()._id) })).status, 404);
  assert.equal((await request('/api/admin/comments', 'POST', { ...input, body: '' })).status, 400);
});
test('statistics support CRUD with consistent totals and reject invalid dates, counts and slots', async () => {
  const created = await request('/api/admin/stats', 'POST', { articleId, dayUtc: '2026-10-23', slot: 12, count: 10 });
  assert.equal(created.status, 201);
  const { data } = await created.json();
  assert.equal(data.total, 10);
  assert.equal((await request(`/api/admin/stats/${data._id}`)).status, 200);
  assert.equal((await request(`/api/admin/stats?q=${articleId}`)).status, 200);
  const updated = await request(`/api/admin/stats/${data._id}`, 'PATCH', { slot: 12, count: 4 });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).data.total, 4);
  assert.deepEqual(lastPipeline[0].$set.total, { $add: [{ $subtract: ['$total', { $ifNull: ['$buckets.12', 0] }] }, 4] });
  assert.equal((await request(`/api/admin/stats/${data._id}`, 'DELETE')).status, 204);
  for (const invalid of [{ slot: 288, count: 1 }, { slot: 1, count: -1 }, { slot: 1.5, count: 1 }]) assert.throws(() => service.parseStats(invalid, false), { status: 400 });
  assert.throws(() => service.parseStats({ articleId, dayUtc: '2026-02-30', slot: 0, count: 1 }, true), { status: 400 });
});
test('bad identifiers, query injection and privileged fields are rejected', async () => {
  assert.equal((await request('/api/admin/users/invalid')).status, 400);
  assert.equal((await request('/api/admin/users?page=0')).status, 400);
  assert.equal((await request('/api/admin/users?q=a&q=b')).status, 400);
  assert.equal((await request('/api/admin/unknown')).status, 404);
  assert.throws(() => service.parseUser({ username: 'a', displayName: 'A', role: 'editor', passwordHash: 'forged' }, true), { status: 400 });
  const spy = mock.method(Article, 'exists', async () => ({ _id: articleId }));
  assert.equal((await request(`/api/admin/users/${new User()._id}`, 'DELETE')).status, 409);
  spy.mock.restore();
});

test('list search escapes regex metacharacters and uses bounded projections and pagination', async () => {
  const spy = mock.method(User, 'find', filter => {
    assert.equal(filter.$or[0].username.$regex, 'writer\\.\\*');
    const q = query([]);
    q.select = fields => { assert.equal(fields, 'username displayName role'); return q; };
    q.skip = offset => { assert.equal(offset, 20); return q; };
    q.limit = limit => { assert.equal(limit, 21); return q; };
    return q;
  });
  assert.equal((await request('/api/admin/users?q=writer.*&page=2')).status, 200);
  spy.mock.restore();
});
