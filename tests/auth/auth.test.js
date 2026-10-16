const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const Article = require('../../src/models/Article');
const Comment = require('../../src/models/Comment');
const ArticleSeen = require('../../src/models/ArticleSeen');
const ViewStats = require('../../src/models/ViewStats');
const { hashPassword, verifyPassword } = require('../../src/utils/password');
const app = require('../../app');

// Only database calls are replaced; HTTP routing, cookies, hashing and EJS are real.
const users = [];
const sessions = new Map();
const articles = new Map();
const password = 'test-password-123';
const content = { title: 'Test article', summary: 'Summary', body: 'Article body', category: 'tech', imageUrl: '' };
let server;
let baseUrl;

function storeArticle(input) {
  const article = new Article(input);
  article.save = async () => { articles.set(String(article._id), article); return article; };
  article.deleteOne = async () => articles.delete(String(article._id));
  articles.set(String(article._id), article);
  return article;
}

async function startServer(application) {
  server = application.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function login(username = 'reporter') {
  const response = await request('/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 303);
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith('dw_session=')).split(';')[0];
}

before(async () => {
  const passwordHash = await hashPassword(password);
  for (const [username, role] of [['reporter', 'reporter'], ['other', 'reporter'], ['editor', 'editor']]) {
    users.push(new User({ username, displayName: username, role, passwordHash }));
  }
  mock.method(User, 'findOne', (filter) => ({
    select: async () => users.find((user) => user.username === filter.username) || null
  }));
  mock.method(Session, 'create', async (input) => { sessions.set(input.tokenHash, { ...input }); });
  mock.method(Session, 'findOne', (filter) => ({ populate: async () => {
    const session = sessions.get(filter.tokenHash);
    if (!session || session.expiresAt <= filter.expiresAt.$gt) return null;
    return { ...session, userId: users.find((user) => String(user._id) === String(session.userId)) || null };
  } }));
  mock.method(Session, 'deleteOne', async (filter) => sessions.delete(filter.tokenHash));
  mock.method(Article, 'create', async (input) => storeArticle(input));
  mock.method(Article, 'findById', async (id) => articles.get(String(id)) || null);
  mock.method(Article, 'find', (filter) => ({ sort: () => ({ populate: () => ({ lean: async () =>
    [...articles.values()]
      .filter((article) => !filter.authorId || String(article.authorId) === String(filter.authorId))
      .map((article) => ({ ...article.toObject(), authorId: users.find((user) => String(user._id) === String(article.authorId)) }))
  }) }) }));
  for (const Model of [Comment, ArticleSeen, ViewStats]) mock.method(Model, 'deleteMany', async () => ({}));
  await startServer(app);
});

beforeEach(() => {
  sessions.clear();
  articles.clear();
});

after(async () => {
  await stopServer();
  mock.restoreAll();
});

test('passwords use salted one-way hashes and reject wrong or placeholder hashes', async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword(password, '!no-password-set'), false);
});

test('login is semantic HTML; incorrect and malformed credentials do not stop the server', async () => {
  const page = await request('/login');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /<label for="username">/);
  for (const body of [{ username: 'missing', password }, { username: 'reporter', password: 'wrong' }]) {
    const response = await request('/login', { method: 'POST', body });
    assert.equal(response.status, 401);
    assert.match(await response.text(), /role="alert"/);
    assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith('dw_session=')), false);
  }
  for (const body of [{}, { username: { $ne: '' }, password }, { username: 'reporter', password: ['x'] }]) {
    assert.equal((await request('/login', { method: 'POST', body })).status, 400);
  }
  assert.equal((await request('/login')).status, 200);
  assert.equal(sessions.size, 0);
});

test('login redirects by the database role, stores only a token hash, and sets cookie protections', async () => {
  for (const [username, location] of [[' REPORTER ', '/reporter'], ['editor', '/editor']]) {
    const response = await request('/login', { method: 'POST', body: { username, password, role: 'editor' } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), location);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('dw_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=604800/);
    const token = cookie.split(';')[0].split('=')[1];
    assert.equal(token.length, 64);
    assert.ok(!sessions.has(token));
    assert.equal((await request(location, { cookie: cookie.split(';')[0] })).status, 200);
  }
});

test('guests can read public pages but cannot access staff pages or any staff mutation', async () => {
  assert.equal((await request('/')).status, 200);
  for (const path of ['/reporter', '/editor', '/staff/articles/new']) {
    const response = await request(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
  const id = String(new Article()._id);
  for (const [method, path] of [
    ['POST', '/api/staff/articles'], ['PATCH', `/api/staff/articles/${id}`],
    ['POST', `/api/staff/articles/${id}/submit`], ['POST', `/api/staff/articles/${id}/approve`],
    ['POST', `/api/staff/articles/${id}/return`], ['DELETE', `/api/staff/articles/${id}`]
  ]) {
    assert.equal((await request(path, { method, body: content })).status, 401);
  }
});

test('reporters create owned drafts and cannot forge authors, roles or publication fields', async () => {
  const cookie = await login();
  const created = await request('/api/staff/articles', { method: 'POST', cookie, body: content });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const article = articles.get(id);
  assert.equal(String(article.authorId), String(users[0]._id));
  assert.equal(article.workflowStatus, 'draft');
  for (const forged of [{ authorId: String(users[1]._id) }, { role: 'editor' }, { workflowStatus: 'published' }, { publishedVersion: content }]) {
    assert.equal((await request(`/api/staff/articles/${id}`, { method: 'PATCH', cookie, body: { ...content, ...forged } })).status, 400);
    assert.equal((await request('/api/staff/articles', { method: 'POST', cookie, body: { ...content, ...forged } })).status, 400);
  }
  assert.equal(article.workflowStatus, 'draft');
  assert.equal(article.publishedVersion, null);
});

test('reporters see/edit only their articles and cannot use editor operations directly', async () => {
  const cookie = await login();
  const own = storeArticle({ authorId: users[0]._id, workingCopy: content });
  const other = storeArticle({ authorId: users[1]._id, workingCopy: { ...content, title: 'Other private title' } });
  const workspace = await request('/reporter', { cookie });
  const html = await workspace.text();
  assert.match(html, /Test article/);
  assert.ok(!html.includes('Other private title'));
  assert.equal((await request(`/staff/articles/${other._id}`, { cookie })).status, 403);
  assert.equal((await request(`/api/staff/articles/${other._id}`, { method: 'PATCH', cookie, body: content })).status, 403);
  assert.equal((await request(`/api/staff/articles/${other._id}/submit`, { method: 'POST', cookie })).status, 403);
  assert.equal((await request('/editor', { cookie })).status, 403);
  for (const action of ['approve', 'return']) {
    assert.equal((await request(`/api/staff/articles/${own._id}/${action}`, { method: 'POST', cookie, body: { note: 'Fix it' } })).status, 403);
  }
  assert.equal((await request(`/api/staff/articles/${own._id}`, { method: 'DELETE', cookie })).status, 403);
  assert.equal((await request(`/api/staff/articles/${own._id}`, { method: 'PATCH', cookie, body: { ...content, title: 'Saved' } })).status, 200);
});

test('reporter submits; editor edits, returns with a note, approves and deletes content', async () => {
  const reporterCookie = await login();
  const editorCookie = await login('editor');
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content });
  const path = `/api/staff/articles/${article._id}`;
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie: editorCookie })).status, 409);
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie: reporterCookie })).status, 200);
  assert.equal((await request(path, { method: 'PATCH', cookie: reporterCookie, body: content })).status, 409);
  assert.equal((await request(`/staff/articles/${article._id}`, { cookie: editorCookie })).status, 200);
  assert.equal((await request(path, { method: 'PATCH', cookie: editorCookie, body: { ...content, title: 'Editor changes' } })).status, 200);
  assert.equal((await request(`${path}/return`, { method: 'POST', cookie: editorCookie, body: { note: '' } })).status, 400);
  assert.equal((await request(`${path}/return`, { method: 'POST', cookie: editorCookie, body: { note: 'Add source' } })).status, 200);
  assert.equal(article.workflowStatus, 'returned');
  assert.equal(article.editorNote, 'Add source');
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie: reporterCookie })).status, 200);
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie: editorCookie })).status, 200);
  assert.equal(article.workflowStatus, 'published');
  assert.equal(article.publishedVersion.title, 'Editor changes');
  assert.equal(article.publicationHistory.length, 1);

  // Editing a published article must not replace the public snapshot before approval.
  assert.equal((await request(path, { method: 'PATCH', cookie: reporterCookie, body: { ...content, title: 'Unapproved update' } })).status, 200);
  assert.equal(article.workflowStatus, 'draft');
  assert.equal(article.publishedVersion.title, 'Editor changes');
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie: reporterCookie })).status, 200);
  assert.equal(article.publishedVersion.title, 'Editor changes');
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie: editorCookie })).status, 200);
  assert.equal(article.publishedVersion.version, 2);
  assert.equal(article.publishedVersion.title, 'Unapproved update');
  assert.equal((await request(path, { method: 'DELETE', cookie: editorCookie })).status, 204);
  assert.equal(articles.has(String(article._id)), false);
  for (const Model of [Comment, ArticleSeen, ViewStats]) {
    assert.equal(String(Model.deleteMany.mock.calls.at(-1).arguments[0].articleId), String(article._id));
  }
});

test('invalid IDs, content and cross-origin requests return errors and leave the server working', async () => {
  const cookie = await login();
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content });
  for (const id of ['invalid-id', String(new Article()._id)]) {
    assert.equal((await request(`/api/staff/articles/${id}`, { method: 'PATCH', cookie, body: content })).status, 404);
  }
  for (const body of [{}, { ...content, category: 'invalid' }, { ...content, imageUrl: 'javascript:alert(1)' }, { ...content, title: { $gt: '' } }]) {
    assert.equal((await request(`/api/staff/articles/${article._id}`, { method: 'PATCH', cookie, body })).status, 400);
  }
  for (const path of ['/login', '/logout', `/api/staff/articles/${article._id}/submit`]) {
    assert.equal((await request(path, { method: 'POST', cookie, body: { username: 'reporter', password }, headers: { Origin: 'https://other.example' } })).status, 403);
  }
  assert.equal((await request('/reporter', { cookie })).status, 200);
});

test('a persisted login works after the app is reloaded and its HTTP server restarted', async () => {
  const cookie = await login();
  await stopServer();
  delete require.cache[require.resolve('../../app')];
  const freshApp = require('../../app');
  await startServer(freshApp);
  const response = await request('/reporter', { cookie });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /reporter/);
});

test('expired, forged and logged-out sessions cannot access protected routes', async () => {
  const cookie = await login();
  assert.equal((await request('/logout', { method: 'POST', cookie })).status, 303);
  assert.equal(sessions.size, 0);
  assert.equal((await request('/reporter', { cookie })).status, 302);
  const expiredCookie = await login();
  for (const session of sessions.values()) session.expiresAt = new Date(Date.now() - 1000);
  assert.equal((await request('/reporter', { cookie: expiredCookie })).status, 302);
  assert.equal((await request('/reporter', { cookie: 'dw_session=forged' })).status, 302);
  assert.equal((await request('/reporter', { cookie: `dw_session=${'a'.repeat(64)}` })).status, 302);
});
