const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const Article = require('../../src/models/Article');
const Comment = require('../../src/models/Comment');
const ArticleSeen = require('../../src/models/ArticleSeen');
const ViewStats = require('../../src/models/ViewStats');
const commentsService = require('../../src/services/comment.service');
const viewsAdapter = require('../../src/services/viewTracking.service');
const { hashPassword, verifyPassword } = require('../../src/utils/password');
const app = require('../../app');

// Only database calls are replaced; HTTP routing, cookies, hashing and EJS are real.
const users = [];
const sessions = new Map();
const articles = new Map();
const password = 'test-password-123';
const content = {
  title: 'Test article', summary: 'Summary', body: 'Article body', category: 'tech',
  imageUrl: 'https://example.com/test.jpg', imageAlt: 'Technology illustration',
  imageCredit: '', imageSourceUrl: '', imageLicense: '', imageLicenseUrl: ''
};
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
  mock.method(Article, 'findOne', (filter) => {
    const query = {
      select() { return this; },
      populate() { return this; },
      async lean() {
        const article = articles.get(String(filter._id));
        if (!article?.publishedVersion) return null;
        return { ...article.toObject(), authorId: users.find((user) => String(user._id) === String(article.authorId)) };
      }
    };
    return query;
  });
  mock.method(commentsService, 'listComments', async () => ({ data: [], meta: { nextCursor: null } }));
  mock.method(commentsService, 'countComments', async () => 0);
  mock.method(viewsAdapter, 'recordVisit', async () => {});
  mock.method(Article, 'find', (filter) => {
    let offset = 0;
    let limit = Infinity;
    let projection;
    const query = {
      select(fields) { projection = fields; return this; },
      sort() { return this; },
      skip(value) { offset = value; return this; },
      limit(value) { limit = value; return this; },
      populate() { return this; },
      async lean() {
        return [...articles.values()]
          .filter((article) => (!filter.authorId || String(article.authorId) === String(filter.authorId)) &&
            (!filter.workflowStatus || article.workflowStatus === filter.workflowStatus) &&
            (!filter['workingCopy.title'] || new RegExp(filter['workingCopy.title'].$regex, filter['workingCopy.title'].$options).test(article.workingCopy.title)))
          .slice(offset, offset + limit)
          .map((article) => ({
            ...(projection ? {
              _id: article._id, workingCopy: { title: article.workingCopy.title },
              workflowStatus: article.workflowStatus, editorNote: article.editorNote
            } : article.toObject()),
            authorId: users.find((user) => String(user._id) === String(article.authorId))
          }));
      }
    };
    return query;
  });
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

test('autosave creates one durable draft, resumes after restart and enforces ownership/review locks', async () => {
  const cookie = await login();
  const id = String(new Article()._id);
  const url = `/api/staff/articles/${id}`;
  assert.equal((await request(url, { method: 'PUT', body: content })).status, 401);
  for (const title of ['', 'First autosave', 'Latest autosave']) {
    const response = await request(url, { method: 'PUT', cookie, body: { ...content, title } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, id);
  }
  assert.equal(articles.size, 1);
  await stopServer();
  await startServer(app);
  assert.match(await (await request(`/staff/articles/${id}`, { cookie })).text(), /Latest autosave/);
  const other = await login('other');
  assert.equal((await request(url, { method: 'PUT', cookie: other, body: content })).status, 403);
  articles.get(id).workflowStatus = 'pending';
  assert.equal((await request(url, { method: 'PUT', cookie, body: content })).status, 409);
  assert.equal((await request('/api/staff/articles/invalid', { method: 'PUT', cookie, body: content })).status, 400);
  assert.equal((await request(url, { method: 'PUT', cookie, body: content, headers: { Origin: 'https://other.example' } })).status, 403);
});

test('autosaving a published update never changes the approved snapshot', async () => {
  const cookie = await login();
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content, workflowStatus: 'published',
    publishedVersion: { ...content, version: 1, publishedAt: new Date() } });
  const response = await request(`/api/staff/articles/${article._id}`, { method: 'PUT', cookie, body: { ...content, body: 'Autosaved revision' } });
  assert.equal(response.status, 200);
  assert.equal(article.workingCopy.body, 'Autosaved revision');
  assert.equal(article.publishedVersion.body, content.body);
  assert.equal(article.workflowStatus, 'draft');
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

test('homepage separates page navigation from account actions for guests, reporters and editors', async () => {
  for (const role of [null, 'reporter', 'editor']) {
    const cookie = role ? await login(role) : undefined;
    const response = await request('/', { cookie });
    assert.equal(response.status, 200);
    const html = await response.text();
    const navigation = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    const account = html.match(/<nav class="staff-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation);
    assert.ok(account);
    assert.match(html, /class="site-masthead"/);
    assert.match(html, /<h1>החדשות האחרונות<\/h1>/);
    assert.match(navigation, /href="\/"/);
    assert.doesNotMatch(navigation, /action="\/logout"|href="\/login"|account-identity/);
    assert.doesNotMatch(account, /href="\/editor|href="\/reporter/);
    if (role) {
      assert.match(navigation, new RegExp(`href="/${role}"`));
      assert.match(account, /class="account-identity"/);
      assert.match(account, new RegExp(`<strong>${role}</strong>`));
      assert.match(account, /action="\/logout" method="post"/);
      assert.equal(navigation.includes('href="/editor/analytics"'), role === 'editor');
    } else {
      assert.match(account, /href="\/login"/);
      assert.doesNotMatch(navigation, /href="\/editor|href="\/reporter/);
    }
  }
});

test('navigation marks exactly one active section, including nested pages and trailing slashes', async () => {
  const reporter = users.find((user) => user.username === 'reporter');
  const article = storeArticle({ authorId: reporter._id, workingCopy: content,
    publishedVersion: { ...content, version: 1, publishedAt: new Date() } });
  const cookies = { editor: await login('editor'), reporter: await login('reporter') };
  for (const [path, role, target] of [
    ['/', null, '/'], ['/?category=tech', 'editor', '/'],
    [`/articles/${article._id}`, null, '/'],
    ['/editor', 'editor', '/editor'], ['/editor/?status=draft', 'editor', '/editor'],
    ['/editor/analytics', 'editor', '/editor/analytics'],
    ['/editor/analytics/?start=2026-10-20', 'editor', '/editor/analytics'],
    ['/reporter', 'reporter', '/reporter'], ['/staff/articles/new', 'reporter', '/reporter'],
    [`/staff/articles/${article._id}`, 'editor', '/editor']
  ]) {
    const response = await request(path, { cookie: cookies[role] });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const navigation = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation, path);
    assert.equal((navigation.match(/aria-current="page"/g) || []).length, 1, path);
    assert.ok(navigation.includes(`aria-current="page" href="${target}"`), path);
  }
  const loginPage = await request('/login');
  const html = await loginPage.text();
  assert.match(html, /class="account-login" aria-current="page"/);
  const navigation = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.doesNotMatch(navigation, /aria-current="page"/);
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

test('guests can load the generated article illustration endpoint', async () => {
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content,
    publishedVersion: { ...content, version: 1, publishedAt: new Date() } });
  const response = await request(`/article-images/${article._id}.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(response.headers.get('cache-control'), /immutable/);
  const svg = await response.text();
  assert.match(svg, /Test article/);
  assert.match(svg, /Summary/);
});

test('editors can create owned articles through both creation endpoints and publish them', async () => {
  const cookie = await login('editor');
  const workspace = await (await request('/editor', { cookie })).text();
  assert.match(workspace, /href="\/staff\/articles\/new"/);
  const page = await request('/staff/articles/new', { cookie });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-action="approve" hidden>/);
  assert.match(html, /data-action="submit"/);
  assert.doesNotMatch(html, /data-action="delete"/);
  const input = { title: 'Editor authored article', summary: 'Summary',
    body: 'Editor content', category: 'tech', imageUrl: '' };
  const created = await request('/api/staff/articles', { method: 'POST', cookie, body: input });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(String(articles.get(id).authorId), String(users[2]._id));
  const draftId = String(new Article()._id);
  const draftInput = { ...input, title: 'Editor autosaved article' };
  assert.equal((await request(`/api/staff/articles/${draftId}`, {
    method: 'PUT', cookie, body: draftInput
  })).status, 200);
  assert.equal(String(articles.get(draftId).authorId), String(users[2]._id));
  // A draft can't be published directly: it must be sent to pending first.
  assert.equal((await request(`/api/staff/articles/${draftId}/approve`, {
    method: 'POST', cookie
  })).status, 409);
  assert.equal((await request(`/api/staff/articles/${draftId}/submit`, {
    method: 'POST', cookie
  })).status, 200);
  assert.equal((await request(`/api/staff/articles/${draftId}/approve`, {
    method: 'POST', cookie
  })).status, 200);
  assert.equal(articles.get(draftId).workflowStatus, 'published');
  assert.equal((await request('/api/staff/articles', {
    method: 'POST', cookie, body: { ...input, authorId: String(users[0]._id) }
  })).status, 400);
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
  assert.equal((await request(`${path}/return`, { method: 'POST', cookie: editorCookie, body: { note: 'Add source' } })).status, 409);
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
  assert.equal((await request(`/api/staff/articles/${article._id}`, {
    method: 'PATCH', cookie, body: { ...content, imageUrl: `/article-images/${article._id}.svg` }
  })).status, 200);
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


test('reporter list shows all four states and correction notes, with server pagination', async () => {
  const cookie = await login();
  const states = ['draft', 'pending', 'published', 'returned'];
  for (let i = 0; i < 25; i++) storeArticle({
    authorId: users[0]._id, workingCopy: { ...content, title: `Own ${i}` },
    workflowStatus: states[i % 4], editorNote: i % 4 === 3 ? 'Add sources' : ''
  });
  storeArticle({ authorId: users[1]._id, workingCopy: { ...content, title: 'Private other article' } });
  const response = await request('/reporter', { cookie });
  const html = await response.text();
  for (const label of ['בהכנה', 'ממתינה לאישור עורך', 'פורסמה', 'הוחזרה לתיקונים', 'Add sources']) assert.ok(html.includes(label));
  assert.ok(!html.includes('Private other article'));
  const first = await (await request('/api/staff/articles', { cookie })).json();
  const second = await (await request('/api/staff/articles?page=2', { cookie })).json();
  assert.equal(first.articles.length, 20);
  assert.equal(first.nextPage, 2);
  assert.equal(second.articles.length, 5);
  assert.equal(second.nextPage, null);
  const ids = [...first.articles, ...second.articles].map((article) => article._id);
  assert.equal(new Set(ids).size, 25);
  assert.ok(first.articles.every((article) => article.workingCopy.body === undefined));
  const filtered = await (await request('/api/staff/articles?status=returned', { cookie })).json();
  assert.ok(filtered.articles.length > 0);
  assert.ok(filtered.articles.every((article) => article.workflowStatus === 'returned'));
});

test('list validation and browser-supplied author filters cannot bypass ownership', async () => {
  const cookie = await login();
  storeArticle({ authorId: users[1]._id, workingCopy: content });
  const response = await request(`/api/staff/articles?authorId=${users[1]._id}&role=editor`, { cookie });
  assert.deepEqual((await response.json()).articles, []);
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=1&page=2', 'status=invalid', 'status=draft&status=pending']) {
    assert.equal((await request(`/api/staff/articles?${query}`, { cookie })).status, 400);
  }
  assert.equal((await request('/api/staff/articles')).status, 401);
});

test('both workspaces render home-style controls and search literal titles within server permissions', async () => {
  storeArticle({ authorId: users[0]._id, workingCopy: { ...content, title: 'News .* match' }, workflowStatus: 'returned' });
  storeArticle({ authorId: users[1]._id, workingCopy: { ...content, title: 'Other news .* match' }, workflowStatus: 'returned' });
  storeArticle({ authorId: users[0]._id, workingCopy: { ...content, title: 'News other match' }, workflowStatus: 'returned' });
  storeArticle({ authorId: users[0]._id, workingCopy: { ...content, title: 'Draft news .* match' } });
  for (const role of ['reporter', 'editor']) {
    const cookie = await login(role);
    const page = await (await request(`/${role}?q=.%2A&status=returned`, { cookie })).text();
    assert.match(page, /class="feed-controls workspace-controls"/);
    assert.match(page, /type="search"[^>]*name="q"/);
    assert.match(page, /value="\.\*"/);
    const response = await request('/api/staff/articles?q=.%2A&status=returned', { cookie });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.articles.length, role === 'editor' ? 2 : 1);
    assert.ok(data.articles.every(article => article.workingCopy.title.includes('.*') && article.workflowStatus === 'returned'));
  }
});

test('reporter submits complete drafts and corrections, but incomplete or pending submissions fail', async () => {
  const cookie = await login();
  const article = storeArticle({ authorId: users[0]._id, workingCopy: { ...content, title: '' } });
  const path = `/api/staff/articles/${article._id}`;
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 400);
  assert.equal(article.workflowStatus, 'draft');
  assert.equal((await request(path, { method: 'PATCH', cookie, body: content })).status, 200);
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 200);
  assert.equal(article.workflowStatus, 'pending');
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 409);
  assert.equal((await request(path, { method: 'PATCH', cookie, body: content })).status, 409);
  article.workflowStatus = 'returned';
  article.editorNote = 'Add a source';
  const page = await (await request(`/staff/articles/${article._id}`, { cookie })).text();
  assert.ok(page.includes('Add a source'));
  assert.equal((await request(path, { method: 'PATCH', cookie, body: { ...content, body: 'Corrected with source' } })).status, 200);
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 200);
  assert.equal(article.editorNote, '');
  assert.equal(article.workingCopy.body, 'Corrected with source');
});

test('published edits can be submitted while the public snapshot stays unchanged', async () => {
  const cookie = await login();
  const publishedAt = new Date();
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content,
    workflowStatus: 'published', publishedVersion: { ...content, version: 1, publishedAt },
    publicationHistory: [{ version: 1, publishedAt, editorId: users[2]._id }] });
  const page = await (await request(`/staff/articles/${article._id}`, { cookie })).text();
  assert.ok(page.includes('data-action="submit"'));
  const original = article.publishedVersion.toObject();
  const path = `/api/staff/articles/${article._id}`;
  const saved = await request(path, { method: 'PATCH', cookie, body: { ...content, title: 'New draft' } });
  assert.equal(saved.status, 200);
  assert.equal(article.workflowStatus, 'draft');
  assert.equal((await saved.json()).statusLabel, 'בהכנה');
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 200);
  assert.deepEqual(article.publishedVersion.toObject(), original);
  assert.equal(article.publicationHistory.length, 1);
});

test('valid Hebrew article bodies fit the request size limit and invalid types are rejected', async () => {
  const cookie = await login();
  const response = await request('/api/staff/articles', { method: 'POST', cookie, body: { ...content, body: 'א'.repeat(50000) } });
  assert.equal(response.status, 201);
  const id = (await response.json()).id;
  assert.equal((await request(`/api/staff/articles/${id}`, { method: 'PATCH', cookie, body: { ...content, body: 'x'.repeat(50001) } })).status, 400);
});

test('editor lists all authors, filters each status and pages filtered results', async () => {
  const cookie = await login('editor');
  for (const state of ['draft', 'pending', 'published', 'returned']) {
    for (let i = 0; i < 22; i++) storeArticle({ authorId: users[i % 2]._id,
      workingCopy: { ...content, title: `${state} ${i}` }, workflowStatus: state });
  }
  for (const state of ['draft', 'pending', 'published', 'returned']) {
    const first = await (await request(`/api/staff/articles?status=${state}`, { cookie })).json();
    const second = await (await request(`/api/staff/articles?status=${state}&page=2`, { cookie })).json();
    assert.equal(first.articles.length, 20);
    assert.equal(second.articles.length, 2);
    assert.equal(second.nextPage, null);
    assert.ok([...first.articles, ...second.articles].every((article) => article.workflowStatus === state));
    assert.equal(new Set(first.articles.map((article) => article.authorId._id)).size, 2);
    const page = await request(`/editor?status=${state}`, { cookie });
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(`value="${state}" selected`));
  }
  const all = await (await request('/api/staff/articles', { cookie })).json();
  assert.equal(all.articles.length, 20);
  assert.equal(all.nextPage, 2);
  assert.equal((await request('/editor?status=invalid', { cookie })).status, 400);
});

test('editor publication requires complete content and valid state transitions', async () => {
  const cookie = await login('editor');
  for (const state of ['draft', 'returned', 'published']) {
    const article = storeArticle({ authorId: users[0]._id, workingCopy: content, workflowStatus: state });
    // Only a pending article may be approved or returned; every other transition is a conflict.
    for (const action of ['approve', 'return']) {
      assert.equal((await request(`/api/staff/articles/${article._id}/${action}`, {
        method: 'POST', cookie, body: { note: 'Fix sources' }
      })).status, 409);
    }
  }
  const article = storeArticle({ authorId: users[1]._id, workingCopy: content, workflowStatus: 'pending' });
  const path = `/api/staff/articles/${article._id}`;
  assert.equal((await request(path, { method: 'PATCH', cookie, body: { ...content, body: '' } })).status, 200);
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 400);
  assert.equal(article.publishedVersion, null);
  assert.equal(article.workflowStatus, 'pending');
  for (const note of ['', ' ', 'x'.repeat(1001), { text: 'Fix sources' }]) {
    assert.equal((await request(`${path}/return`, { method: 'POST', cookie, body: { note } })).status, 400);
  }
  assert.equal((await request(path, { method: 'PATCH', cookie, body: content })).status, 200);
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 200);
  assert.equal(article.publicationHistory.length, 1);
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 409);
  assert.equal(article.publicationHistory.length, 1);
});

test('articles can be submitted and published without an image or description', async () => {
  const cookie = await login('editor');
  const reporterCookie = await login();
  for (const imageUrl of ['', 'https://example.com/article.jpg']) {
    const article = storeArticle({
      authorId: users[0]._id,
      workingCopy: { ...content, imageUrl, imageAlt: '' },
      workflowStatus: 'draft'
    });
    const input = { title: `Optional image ${imageUrl}`, summary: content.summary,
      body: content.body, category: content.category, imageUrl };
    assert.equal((await request(`/api/staff/articles/${article._id}`, {
      method: 'PUT', cookie: reporterCookie, body: input
    })).status, 200);
    assert.equal((await request(`/api/staff/articles/${article._id}/submit`, {
      method: 'POST', cookie: reporterCookie
    })).status, 200);
    assert.equal((await request(`/api/staff/articles/${article._id}/approve`, { method: 'POST', cookie })).status, 200);
    assert.equal(article.workflowStatus, 'published');
    const html = await (await request(`/articles/${article._id}`)).text();
    assert.ok(html.includes(`src="${imageUrl || '/images/article-placeholder.svg'}"`));
    if (imageUrl) assert.ok(html.includes(`alt="${input.title}"`));
  }
  assert.equal((await request('/images/article-placeholder.svg')).status, 200);
});

test('editors edit drafts, returned articles and published updates, send them to pending, then publish', async () => {
  const cookie = await login('editor');
  const reporterCookie = await login();
  for (const state of ['draft', 'returned', 'published']) {
    const publishedAt = new Date();
    const wasPublished = state === 'published';
    const article = storeArticle({ authorId: users[0]._id, workingCopy: content, workflowStatus: state,
      editorNote: state === 'returned' ? 'Add sources' : '',
      ...(wasPublished ? {
        publishedVersion: { ...content, version: 1, publishedAt },
        publicationHistory: [{ version: 1, publishedAt, editorId: users[2]._id }]
      } : {}) });
    const path = `/api/staff/articles/${article._id}`;
    const update = { ...content, title: `Editor revision of ${state}`, body: 'Edited by the editor' };
    // Incomplete content can't be sent for approval.
    assert.equal((await request(`/api/staff/articles/${article._id}`, {
      method: 'PUT', cookie, body: { ...update, body: '' }
    })).status, 200);
    assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 400);
    assert.equal(article.publicationHistory.length, wasPublished ? 1 : 0);
    assert.equal((await request(`/api/staff/articles/${article._id}`, {
      method: 'PUT', cookie, body: update
    })).status, 200);
    assert.equal(article.workflowStatus, state === 'returned' ? 'returned' : 'draft');
    assert.equal(article.publishedVersion?.title || null, wasPublished ? content.title : null);
    const page = await (await request(`/staff/articles/${article._id}`, { cookie })).text();
    assert.match(page, /data-action="submit"/);
    assert.match(page, /data-action="approve" hidden>/);
    assert.match(page, /id="return-panel" class="return-panel" hidden>/);
    if (wasPublished) assert.match(page, /גרסה 1 של הכתבה מוצגת כעת לציבור/);
    // Not pending yet: publishing directly is not an allowed transition.
    assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 409);
    assert.equal((await request(`${path}/submit`, { method: 'POST', cookie })).status, 200);
    assert.equal(article.workflowStatus, 'pending');
    assert.equal(article.publishedVersion?.title || null, wasPublished ? content.title : null);
    assert.equal((await request(`${path}/approve`, { method: 'POST', cookie: reporterCookie })).status, 403);
    assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 200);
    assert.equal(article.workflowStatus, 'published');
    assert.equal(article.publishedVersion.title, update.title);
    assert.equal(article.publishedVersion.body, update.body);
    assert.equal(article.publishedVersion.version, wasPublished ? 2 : 1);
    assert.equal(article.publicationHistory.length, wasPublished ? 2 : 1);
    assert.equal(String(article.publicationHistory.at(-1).editorId), String(users[2]._id));
    assert.equal(String(article.authorId), String(users[0]._id));
    assert.equal(article.editorNote, '');
    assert.match(await (await request(`/articles/${article._id}`)).text(), new RegExp(update.title));
    assert.equal((await request(`${path}/approve`, { method: 'POST', cookie })).status, 409);
  }
});

test('editing without attribution inputs preserves credits through autosave and publication', async () => {
  const cookie = await login('editor');
  const attribution = {
    imageCredit: 'Original creator', imageSourceUrl: 'https://example.com/source',
    imageLicense: 'CC BY 4.0', imageLicenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
  };
  const article = storeArticle({
    authorId: users[0]._id, workingCopy: { ...content, ...attribution },
    workflowStatus: 'published',
    publishedVersion: { ...content, ...attribution, version: 1, publishedAt: new Date() }
  });
  const html = await (await request(`/staff/articles/${article._id}`, { cookie })).text();
  for (const field of Object.keys(attribution)) assert.ok(!html.includes(`name="${field}"`));
  assert.match(html, /name="imageUrl"/);
  assert.doesNotMatch(html, /name="imageAlt"/);
  const input = { ...content, title: 'Updated article' };
  for (const field of Object.keys(attribution)) delete input[field];
  assert.equal((await request(`/api/staff/articles/${article._id}`, {
    method: 'PUT', cookie, body: input
  })).status, 200);
  for (const [field, value] of Object.entries(attribution)) {
    assert.equal(article.workingCopy[field], value);
    assert.equal(article.publishedVersion[field], value);
  }
  assert.equal((await request(`/api/staff/articles/${article._id}/submit`, {
    method: 'POST', cookie
  })).status, 200);
  assert.equal((await request(`/api/staff/articles/${article._id}/approve`, {
    method: 'POST', cookie
  })).status, 200);
  const published = await (await request(`/articles/${article._id}`)).text();
  for (const [field, value] of Object.entries(attribution)) {
    assert.equal(article.publishedVersion[field], value);
    assert.ok(published.includes(value));
  }
});

test('editor sees published and submitted versions while the public sees only approved content', async () => {
  const reporterCookie = await login();
  const editorCookie = await login('editor');
  const publishedAt = new Date();
  const approved = { ...content, title: 'Approved original', body: 'Approved body', category: 'world', imageUrl: 'https://example.com/original.jpg' };
  const article = storeArticle({ authorId: users[0]._id, workingCopy: approved,
    workflowStatus: 'published', publishedVersion: { ...approved, version: 1, publishedAt },
    publicationHistory: [{ version: 1, publishedAt, editorId: users[2]._id }] });
  const path = `/api/staff/articles/${article._id}`;
  const publicPath = `/articles/${article._id}`;
  const update = { ...content, title: 'Unapproved revision', body: 'Unapproved body' };
  const expectOriginal = async () => {
    const response = await request(publicPath);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Approved original'));
    assert.ok(!html.includes('Unapproved revision'));
  };
  await expectOriginal();
  assert.equal((await request(path, { method: 'PATCH', cookie: reporterCookie, body: update })).status, 200);
  await expectOriginal();
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie: reporterCookie })).status, 200);
  await expectOriginal();
  const review = await (await request(`/staff/articles/${article._id}`, { cookie: editorCookie })).text();
  for (const text of ['התוכן שהוגש לאישור', 'הגרסה המפורסמת כעת', 'Approved original', 'Unapproved revision', 'https://example.com/original.jpg', 'עולם']) assert.ok(review.includes(text));
  assert.equal((await request(`${path}/return`, { method: 'POST', cookie: editorCookie, body: { note: 'Add sources' } })).status, 200);
  await expectOriginal();
  assert.equal((await request(`${path}/submit`, { method: 'POST', cookie: reporterCookie })).status, 200);
  assert.equal((await request(`${path}/approve`, { method: 'POST', cookie: editorCookie })).status, 200);
  const published = await (await request(publicPath)).text();
  assert.ok(published.includes('Unapproved revision'));
  assert.ok(!published.includes('Approved original'));
  assert.equal(article.publishedVersion.version, 2);
  assert.equal(article.publicationHistory.length, 2);
  assert.equal((await request(path, { method: 'DELETE', cookie: editorCookie })).status, 204);
  assert.equal((await request(publicPath)).status, 404);
});

test('editor page shows the approved snapshot after approval; article read API enforces ownership', async () => {
  const reporterCookie = await login();
  const editorCookie = await login('editor');
  const article = storeArticle({ authorId: users[0]._id, workingCopy: content, workflowStatus: 'pending' });
  const apiUrl = `/api/staff/articles/${article._id}`;
  const pageUrl = `/staff/articles/${article._id}`;
  assert.equal((await request(apiUrl)).status, 401);
  const otherCookie = await login('other');
  assert.equal((await request(apiUrl, { cookie: otherCookie })).status, 403);
  assert.doesNotMatch(await (await request(pageUrl, { cookie: editorCookie })).text(), /הגרסה המפורסמת כעת/);
  assert.equal((await request(`${apiUrl}/approve`, { method: 'POST', cookie: editorCookie })).status, 200);
  await request(apiUrl, { method: 'PATCH', cookie: reporterCookie, body: { ...content, title: 'Private new title' } });
  const html = await (await request(pageUrl, { cookie: editorCookie })).text();
  assert.match(html, /הגרסה המפורסמת כעת/);
  assert.match(html, /גרסה 1/);
  assert.ok(html.includes(content.title));
  assert.ok(html.includes('Private new title'));
});
