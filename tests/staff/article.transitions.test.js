const test = require('node:test');
const assert = require('node:assert/strict');
const staffService = require('../../src/modules/staff/staff.service');
const Article = require('../../src/models/Article');

const reporter1 = { _id: '660000000000000000000001', role: 'reporter', displayName: 'כתב 1' };
const reporter2 = { _id: '660000000000000000000002', role: 'reporter', displayName: 'כתב 2' };
const editor = { _id: '660000000000000000000003', role: 'editor', displayName: 'עורך ראשי' };

const validContent = {
  title: 'כותרת כתבה לדוגמה',
  summary: 'תקציר קצר לכתבה',
  body: 'תוכן מלא של הכתבה עם מספיק פירוט',
  category: 'tech',
  imageUrl: 'https://example.com/pic.jpg'
};

function createMockArticle(overrides = {}) {
  let doc = {
    _id: '507f1f77bcf86cd799439011',
    authorId: reporter1._id,
    workingCopy: {
      ...validContent,
      toObject() { return { ...this }; },
      ...(overrides.workingCopy || {})
    },
    publishedVersion: overrides.publishedVersion || null,
    workflowStatus: overrides.workflowStatus || 'draft',
    editorNote: overrides.editorNote || '',
    revision: overrides.revision || 0,
    publicationHistory: overrides.publicationHistory || [],
    async save() { return this; }
  };
  return Object.assign(doc, overrides);
}

test('new article begins in draft status with 0 revision and no public version', () => {
  const article = createMockArticle();
  assert.equal(article.workflowStatus, 'draft');
  assert.equal(article.revision, 0);
  assert.equal(article.publishedVersion, null);
});

test('valid transition: draft -> pending (reporter submit)', async () => {
  const article = createMockArticle({ workflowStatus: 'draft' });
  test.mock.method(Article, 'findById', async () => article);

  const updated = await staffService.transitionArticle(article._id, reporter1, 'submit');
  assert.equal(updated.workflowStatus, 'pending');
  assert.equal(updated.editorNote, '');
  assert.equal(updated.revision, 1);
});

test('valid transition: pending -> returned with note (editor return)', async () => {
  const article = createMockArticle({ workflowStatus: 'pending' });
  test.mock.method(Article, 'findById', async () => article);

  const updated = await staffService.transitionArticle(article._id, editor, 'return', 'נא לחדד את המסקנות');
  assert.equal(updated.workflowStatus, 'returned');
  assert.equal(updated.editorNote, 'נא לחדד את המסקנות');
  assert.equal(updated.revision, 1);
});

test('valid transition: returned -> pending (reporter resubmit clears editorNote)', async () => {
  const article = createMockArticle({ workflowStatus: 'returned', editorNote: 'הערה ישנה' });
  test.mock.method(Article, 'findById', async () => article);

  const updated = await staffService.transitionArticle(article._id, reporter1, 'submit');
  assert.equal(updated.workflowStatus, 'pending');
  assert.equal(updated.editorNote, '');
  assert.equal(updated.revision, 1);
});

test('valid transition: pending -> published (editor approve updates publishedVersion and history)', async () => {
  const article = createMockArticle({ workflowStatus: 'pending' });
  test.mock.method(Article, 'findById', async () => article);

  const updated = await staffService.transitionArticle(article._id, editor, 'approve');
  assert.equal(updated.workflowStatus, 'published');
  assert.equal(updated.editorNote, '');
  assert.ok(updated.publishedVersion);
  assert.equal(updated.publishedVersion.version, 1);
  assert.equal(updated.publishedVersion.title, validContent.title);
  assert.equal(updated.publicationHistory.length, 1);
  assert.equal(updated.publicationHistory[0].version, 1);
  assert.equal(String(updated.publicationHistory[0].editorId), String(editor._id));
});

test('valid transition: published article update passes approval and increments version', async () => {
  const publishedAt1 = new Date('2026-10-01T10:00:00Z');
  const article = createMockArticle({
    workflowStatus: 'published',
    publishedVersion: { ...validContent, version: 1, publishedAt: publishedAt1 },
    publicationHistory: [{ version: 1, publishedAt: publishedAt1, editorId: editor._id }]
  });
  test.mock.method(Article, 'findById', async () => article);

  // Update working copy title
  article.workingCopy.title = 'כותרת מעודכנת';
  article.workflowStatus = 'draft';

  // Submit update
  await staffService.transitionArticle(article._id, reporter1, 'submit');
  assert.equal(article.workflowStatus, 'pending');
  // Live version still shows v1
  assert.equal(article.publishedVersion.version, 1);
  assert.equal(article.publishedVersion.title, validContent.title);

  // Editor approves update
  await staffService.transitionArticle(article._id, editor, 'approve');
  assert.equal(article.workflowStatus, 'published');
  assert.equal(article.publishedVersion.version, 2);
  assert.equal(article.publishedVersion.title, 'כותרת מעודכנת');
  assert.equal(article.publicationHistory.length, 2);
  assert.equal(article.publicationHistory[1].version, 2);
});

test('invalid transitions are blocked with 409 INVALID_TRANSITION', async () => {
  // 1. Cannot submit an article that is already pending
  {
    const article = createMockArticle({ workflowStatus: 'pending' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, reporter1, 'submit'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
  }

  // 2. Editor cannot approve draft directly
  {
    const article = createMockArticle({ workflowStatus: 'draft' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'approve'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
  }

  // 3. Editor cannot return draft directly
  {
    const article = createMockArticle({ workflowStatus: 'draft' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'return', 'note'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
  }

  // 4. Editor cannot approve returned article before resubmission
  {
    const article = createMockArticle({ workflowStatus: 'returned' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'approve'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
  }

  // 5. Editor cannot return already published article
  {
    const article = createMockArticle({ workflowStatus: 'published' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'return', 'note'),
      (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
    );
  }
});

test('role and ownership security guards are strictly enforced (403)', async () => {
  // Reporter cannot approve or return
  {
    const article = createMockArticle({ workflowStatus: 'pending' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, reporter1, 'approve'),
      (err) => err.status === 403 && err.code === 'FORBIDDEN'
    );
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, reporter1, 'return', 'note'),
      (err) => err.status === 403 && err.code === 'FORBIDDEN'
    );
  }

  // Editor cannot submit on behalf of reporter
  {
    const article = createMockArticle({ workflowStatus: 'draft' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'submit'),
      (err) => err.status === 403 && err.code === 'FORBIDDEN'
    );
  }

  // Reporter cannot submit another reporter's article
  {
    const article = createMockArticle({ workflowStatus: 'draft', authorId: reporter2._id });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, reporter1, 'submit'),
      (err) => err.status === 403 && err.code === 'FORBIDDEN'
    );
  }
});

test('validation requirements before transition', async () => {
  // Incomplete draft cannot be submitted (missing summary)
  {
    const article = createMockArticle({
      workflowStatus: 'draft',
      workingCopy: { ...validContent, summary: '' }
    });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, reporter1, 'submit'),
      (err) => err.status === 400 && err.code === 'INCOMPLETE_ARTICLE'
    );
  }

  // Returning article without a note is rejected
  {
    const article = createMockArticle({ workflowStatus: 'pending' });
    test.mock.method(Article, 'findById', async () => article);
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'return', ''),
      (err) => err.status === 400 && err.code === 'NOTE_REQUIRED'
    );
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'return', '   '),
      (err) => err.status === 400 && err.code === 'NOTE_REQUIRED'
    );
    await assert.rejects(
      async () => staffService.transitionArticle(article._id, editor, 'return', 'a'.repeat(1001)),
      (err) => err.status === 400 && err.code === 'NOTE_REQUIRED'
    );
  }
});
