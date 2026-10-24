const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ejs = require('ejs');
const path = require('node:path');
const Article = require('../../src/models/Article');
const articleService = require('../../src/services/article.service');
const commentsService = require('../../src/services/comment.service');
const viewsAdapter = require('../../src/services/viewTracking.service');
const articleController = require('../../src/controllers/article.controller');
const { splitParagraphs } = articleService;
const { FALLBACK_IMAGE_URL, getArticleMedia, renderArticleIllustration } = require('../../src/services/articleImage.service');
const { getBucket } = require('../../src/services/viewTracking.service');
const {
  parseCommentInput,
  encodeCursor,
  decodeCursor
} = require('../../src/services/comment.service');

test('inline comment moderation is rendered only for editors and uses public comment IDs', async () => {
  for (const currentUser of [null, { role: 'reporter' }, { role: 'editor' }]) {
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/comments.ejs'), {
      currentUser, articleId: 'article', commentCount: 1, formatDate: () => 'today',
      comments: { data: [{ id: 'public-comment-id', authorName: 'Reader', body: '<script>unsafe</script>', createdAt: '2026-10-24' }], meta: {} }
    });
    assert.ok(html.includes('data-delete-comment="public-comment-id"') === (currentUser?.role === 'editor'));
    assert.ok(html.includes(`data-can-moderate="${currentUser?.role === 'editor'}"`));
    assert.doesNotMatch(html, /<script>unsafe/);
  }
});

test('article media supplies a local fallback and preserves accessible alt text', () => {
  assert.deepEqual(getArticleMedia({ title: 'News', imageUrl: '', imageAlt: '' }), {
    imageUrl: FALLBACK_IMAGE_URL,
    imageAlt: '',
    imageCredit: '',
    imageSourceUrl: '',
    imageLicense: '',
    imageLicenseUrl: ''
  });
  assert.deepEqual(getArticleMedia({ title: 'News', imageUrl: 'https://example.com/news.jpg', imageAlt: 'A city hall' }), {
    imageUrl: 'https://example.com/news.jpg',
    imageAlt: 'A city hall',
    imageCredit: '',
    imageSourceUrl: '',
    imageLicense: '',
    imageLicenseUrl: ''
  });
  assert.deepEqual(getArticleMedia({ title: 'News', imageUrl: 'https://example.com/news.jpg' }), {
    imageUrl: 'https://example.com/news.jpg',
    imageAlt: 'News',
    imageCredit: '',
    imageSourceUrl: '',
    imageLicense: '',
    imageLicenseUrl: ''
  });
});

test('article illustration includes story context and escapes XML input', () => {
  const svg = renderArticleIllustration({
    category: 'tech', categoryLabel: 'טכנולוגיה',
    title: '<מחקר> & פיתוח', summary: 'תיאור "בדיקה" עם & סימנים'
  });
  assert.match(svg, /&lt;מחקר&gt; &amp; פיתוח/);
  assert.match(svg, /תיאור &quot;בדיקה&quot; עם &amp; סימנים/);
  assert.doesNotMatch(svg, /<מחקר>/);
});

test('generated article-image endpoint sends SVG with immutable cache headers', async (t) => {
  const article = {
    category: 'tech', categoryLabel: 'טכנולוגיה', title: 'כותרת', summary: 'תקציר'
  };
  let contentType, cacheControl, image;
  t.mock.method(articleService, 'getPublicArticle', async (id) => {
    assert.equal(id, 'article-id');
    return article;
  });
  const response = {
    type(value) { contentType = value; return this; },
    set(name, value) { if (name === 'Cache-Control') cacheControl = value; return this; },
    send(value) { image = value; return this; }
  };

  await articleController.renderArticleImage({ params: { id: 'article-id' } }, response);

  assert.equal(contentType, 'image/svg+xml');
  assert.equal(cacheControl, 'public, max-age=31536000, immutable');
  assert.match(image, /<svg/);
  assert.match(image, /כותרת/);
});

test('public article service supplies the fallback for legacy articles without an image', async (t) => {
  const id = new mongoose.Types.ObjectId();
  t.mock.method(Article, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: id.toString(), 'publishedVersion.publishedAt': { $ne: null } });
    const query = {
      select() { return this; },
      populate() { return this; },
      async lean() {
        return {
          _id: id,
          authorId: { displayName: 'Reporter' },
          publishedVersion: { title: 'Older article', summary: '', body: 'Body', category: 'tech', imageUrl: '', imageAlt: '' },
          publicationHistory: []
        };
      }
    };
    return query;
  });

  const article = await articleService.getPublicArticle(String(id));
  assert.equal(article.imageUrl, FALLBACK_IMAGE_URL);
  assert.equal(article.imageAlt, '');
});

test('each public article render records a visit without blocking on tracking failure', async (t) => {
  const article = { id: 'article-id', title: 'A published story' };
  const comments = { data: [], meta: { nextCursor: null, hasMore: false } };
  let visits = 0;
  const rendered = [];
  t.mock.method(articleService, 'getPublicArticle', async () => article);
  t.mock.method(commentsService, 'listComments', async () => comments);
  t.mock.method(commentsService, 'countComments', async () => 0);
  t.mock.method(viewsAdapter, 'recordVisit', async () => {
    visits++;
    if (visits === 2) throw new Error('database unavailable');
  });
  t.mock.method(console, 'error', () => {});

  const request = { params: { id: article.id }, deviceId: 'browser-id' };
  const response = { render: (view, locals) => rendered.push({ view, locals }) };
  await articleController.renderArticle(request, response);
  await articleController.renderArticle(request, response);

  assert.equal(visits, 2);
  assert.equal(rendered.length, 2);
  assert.ok(rendered.every(({ view }) => view === 'public/article'));
});

test('splitParagraphs splits on blank lines and drops empty ones', () => {
  assert.deepEqual(splitParagraphs('first\n\nsecond\n  \nthird\n\n\n'), ['first', 'second', 'third']);
  assert.deepEqual(splitParagraphs(''), []);
  assert.deepEqual(splitParagraphs(undefined), []);
});

test('getBucket maps a time to its UTC day and 5-minute slot', () => {
  const { dayUtc, slot } = getBucket(new Date('2026-10-11T14:07:30.000Z'));
  assert.equal(dayUtc.toISOString(), '2026-10-11T00:00:00.000Z');
  assert.equal(slot, 14 * 12 + 1);
});

test('getBucket uses the last slot just before midnight', () => {
  assert.equal(getBucket(new Date('2026-10-11T23:59:59.999Z')).slot, 287);
});

test('parseCommentInput trims and defaults the guest name', () => {
  assert.deepEqual(parseCommentInput({ authorName: '  ', body: '  שלום  ' }), {
    authorName: 'אורח',
    body: 'שלום'
  });
});

test('parseCommentInput rejects an empty body and over-long fields', () => {
  assert.throws(() => parseCommentInput({ body: '   ' }), (err) => {
    assert.equal(err.status, 400);
    assert.ok(err.fields.body);
    return true;
  });
  assert.throws(() => parseCommentInput({ authorName: 'א'.repeat(51), body: 'x'.repeat(1001) }), (err) => {
    assert.deepEqual(Object.keys(err.fields).sort(), ['authorName', 'body']);
    return true;
  });
});

test('parseCommentInput ignores non-string values and missing bodies', () => {
  assert.throws(() => parseCommentInput(undefined), { status: 400 });
  assert.throws(() => parseCommentInput({ body: { $gt: '' } }), { status: 400 });
});

test('comment cursor round-trips and rejects tampering', () => {
  const comment = { _id: new mongoose.Types.ObjectId(), createdAt: new Date('2026-10-11T10:00:00.000Z') };
  const decoded = decodeCursor(encodeCursor(comment));
  assert.equal(decoded.date.toISOString(), comment.createdAt.toISOString());
  assert.equal(String(decoded.id), String(comment._id));
  assert.throws(() => decodeCursor('garbage'), { status: 400, code: 'INVALID_CURSOR' });
  assert.throws(() => decodeCursor(['a', 'b']), { status: 400 });
});
