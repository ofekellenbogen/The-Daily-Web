// Live HTTP verification against an isolated, disposable MongoDB database.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const mongoose = require('mongoose');
const User = require('../../src/models/User');
const Article = require('../../src/models/Article');
const Comment = require('../../src/models/Comment');
const ViewStats = require('../../src/models/ViewStats');
const Session = require('../../src/models/Session');
const { hashPassword } = require('../../src/utils/password');
const { createSession } = require('../../src/modules/auth/auth.service');
const app = require('../../app');
const mode = process.argv[2];
const dbName = `daily_web_verify_${randomBytes(8).toString('hex')}`;
let server, base;
const content = { title: 'Verification article', summary: 'Summary', body: 'Original', category: 'tech', imageUrl: '' };
async function request(path, method = 'GET', body, cookie) {
  return fetch(`${base}${path}`, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function main() {
  assert.ok(['crud', 'autosave'].includes(mode), 'Pass crud or autosave');
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.init(), Article.init(), Comment.init(), ViewStats.init(), Session.init()]);
  const passwordHash = await hashPassword(randomBytes(16).toString('hex'));
  const reporter = await User.create({ username: 'verify.reporter', displayName: 'Reporter', role: 'reporter', passwordHash });
  const editor = await User.create({ username: 'verify.editor', displayName: 'Editor', role: 'editor', passwordHash });
  const reporterCookie = `dw_session=${await createSession(reporter._id)}`;
  const editorCookie = `dw_session=${await createSession(editor._id)}`;
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  if (mode === 'autosave') {
    const id = String(new mongoose.Types.ObjectId());
    const path = `/api/staff/drafts/${id}`;
    assert.equal((await request(path, 'PUT', content, reporterCookie)).status, 200);
    assert.equal((await request(path, 'PUT', { ...content, body: 'Latest text' }, reporterCookie)).status, 200);
    assert.equal(await Article.countDocuments(), 1);
    assert.match(await (await request(`/staff/articles/${id}`, 'GET', undefined, reporterCookie)).text(), /Latest text/);
    await Article.updateOne({ _id: id }, { $set: { publishedVersion: { ...content, version: 1, publishedAt: new Date() }, workflowStatus: 'published' } });
    assert.equal((await request(path, 'PUT', { ...content, body: 'Unapproved' }, reporterCookie)).status, 200);
    assert.equal((await Article.findById(id)).publishedVersion.body, 'Original');
    assert.equal((await request(`/api/staff/articles/${id}/submit`, 'POST', undefined, reporterCookie)).status, 200);
    assert.equal((await request(path, 'PUT', content, reporterCookie)).status, 409);
    // Reconnect as a second process/computer would, using only persistent data and session.
    await mongoose.disconnect(); await mongoose.connect(process.env.MONGODB_URI, { dbName });
    assert.match(await (await request(`/staff/articles/${id}`, 'GET', undefined, reporterCookie)).text(), /Unapproved/);
  } else {
    const article = await Article.create({ authorId: reporter._id, workingCopy: content });
    assert.equal((await request('/editor/users', 'GET', undefined, editorCookie)).status, 200);
    assert.equal((await request('/api/admin/users', 'GET', undefined, reporterCookie)).status, 403);
    const cases = [
      ['users', { username: 'verify.new', displayName: 'New user', role: 'reporter', password: 'verification-only' }, { username: 'verify.new', displayName: 'Changed', role: 'reporter', password: '' }],
      ['comments', { articleId: String(article._id), authorName: 'Reader', body: 'Original' }, { authorName: 'Reader', body: 'Changed' }],
      ['stats', { articleId: String(article._id), dayUtc: '2026-10-23', slot: 12, count: 10 }, { slot: 12, count: 3 }]
    ];
    for (const [resource, input, change] of cases) {
      const path = `/api/admin/${resource}`;
      const response = await request(path, 'POST', input, editorCookie); assert.equal(response.status, 201);
      const { data } = await response.json();
      assert.equal(data.passwordHash, undefined); assert.equal(data.deviceId, undefined);
      const listed = await (await request(path, 'GET', undefined, editorCookie)).json();
      assert.ok(listed.data.some(row => row._id === data._id));
      const read = await (await request(`${path}/${data._id}`, 'GET', undefined, editorCookie)).json();
      assert.equal(read.data.passwordHash, undefined); assert.equal(read.data.deviceId, undefined);
      const updated = await request(`${path}/${data._id}`, 'PATCH', change, editorCookie); assert.equal(updated.status, 200);
      if (resource === 'stats') assert.equal((await updated.json()).data.total, 3);
      assert.equal((await request(`${path}/${data._id}`, 'DELETE', undefined, editorCookie)).status, 204);
      assert.equal((await request(`${path}/${data._id}`, 'GET', undefined, editorCookie)).status, 404);
    }
    assert.equal((await request(`/api/admin/users/${reporter._id}`, 'DELETE', undefined, editorCookie)).status, 409);
  }
  console.log(`LIVE_${mode.toUpperCase()}_VERIFICATION_PASSED`);
}
const timeout = setTimeout(() => { console.error('Verification timed out'); process.exit(2); }, 45000);
main().catch(error => { console.error('Verification failed:', error.name, error.code || 'assertion'); process.exitCode = 1; }).finally(async () => {
  try {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    // Only this invocation's disposable database may be removed.
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName && /^daily_web_verify_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  } finally { await mongoose.disconnect(); clearTimeout(timeout); }
});
