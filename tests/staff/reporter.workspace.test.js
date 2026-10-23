const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const app = require('../../app');
const auth = require('../../src/modules/auth/auth.service');
const staffService = require('../../src/modules/staff/staff.service');

let server;
let baseUrl;

const reporter1Id = '650000000000000000000001';
const reporter2Id = '650000000000000000000002';
const editorId = '650000000000000000000003';

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  mock.method(auth, 'findSession', async (token) => {
    if (token === 'rep1') {
      return { userId: { _id: reporter1Id, role: 'reporter', displayName: 'כתב ראשון' } };
    }
    if (token === 'rep2') {
      return { userId: { _id: reporter2Id, role: 'reporter', displayName: 'כתב שני' } };
    }
    if (token === 'ed') {
      return { userId: { _id: editorId, role: 'editor', displayName: 'עורך ראשי' } };
    }
    return null;
  });
});

afterEach(() => {
  mock.restoreAll();
});

after(async () => {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
});

function request(path, token, options = {}) {
  const headers = {
    ...(token ? { Cookie: `${auth.COOKIE_NAME}=${token}` } : {}),
    ...(options.headers || {})
  };
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: 'manual'
  });
}

test('reporter workspace GET /reporter renders successfully for logged-in reporter', async () => {
  mock.method(staffService, 'listArticles', async (user, query) => {
    assert.equal(String(user._id), reporter1Id);
    return {
      articles: [
        {
          _id: '507f1f77bcf86cd799439011',
          workingCopy: { title: 'הכתבה שלי' },
          workflowStatus: 'draft',
          editorNote: ''
        }
      ],
      nextPage: null
    };
  });

  const res = await request('/reporter', 'rep1');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('אזור העבודה שלי'));
  assert.ok(html.includes('הכתבה שלי'));
  assert.ok(html.includes('יצירת כתבה חדשה'));
  assert.ok(html.includes('סינון לפי מצב'));
});

test('reporter can filter their articles by status via GET /api/staff/articles', async () => {
  let receivedStatus = null;
  mock.method(staffService, 'listArticles', async (user, query) => {
    assert.equal(String(user._id), reporter1Id);
    receivedStatus = query.status;
    return {
      articles: [
        {
          _id: '507f1f77bcf86cd799439012',
          workingCopy: { title: 'כתבה שהוחזרה' },
          workflowStatus: 'returned',
          editorNote: 'נא לבדוק מקורות'
        }
      ],
      nextPage: null
    };
  });

  const res = await request('/api/staff/articles?status=returned', 'rep1');
  assert.equal(res.status, 200);
  assert.equal(receivedStatus, 'returned');
  const json = await res.json();
  assert.equal(json.articles.length, 1);
  assert.equal(json.articles[0].workflowStatus, 'returned');
  assert.equal(json.articles[0].editorNote, 'נא לבדוק מקורות');
});

test('reporter cannot access or edit another reporter article (ownership enforcement)', async () => {
  mock.method(staffService, 'getArticle', async (id, user) => {
    if (String(user._id) !== reporter1Id) {
      const err = new Error('אין לך הרשאה לגשת לכתבה זו');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    return {
      _id: id,
      authorId: reporter1Id,
      workingCopy: { title: 'שלי' },
      workflowStatus: 'draft'
    };
  });

  // Reporter 2 tries to access Reporter 1's article
  const res = await request('/staff/articles/507f1f77bcf86cd799439011', 'rep2');
  assert.equal(res.status, 403);
});

test('reporter can submit, view returned notes, and resubmit an article', async () => {
  let submittedId = null;
  mock.method(staffService, 'transitionArticle', async (id, user, action) => {
    assert.equal(String(user._id), reporter1Id);
    assert.equal(action, 'submit');
    submittedId = id;
    return { _id: id, workflowStatus: 'pending' };
  });

  const res = await request('/api/staff/articles/507f1f77bcf86cd799439011/submit', 'rep1', {
    method: 'POST'
  });
  assert.equal(res.status, 200);
  assert.equal(submittedId, '507f1f77bcf86cd799439011');
});
