const { test } = require('node:test');
const assert = require('node:assert/strict');
const Article = require('../../src/models/Article');
const service = require('../../src/modules/staff/staff.service');

const user = { _id: '0123456789abcdef01234567', role: 'reporter' };
function mockTitleLookup(t, result, onFilter = () => {}) {
  return t.mock.method(Article, 'findOne', (filter) => {
    onFilter(filter);
    return {
      select() { return this; },
      lean: async () => result
    };
  });
}

const content = {
  title: 'Breaking News',
  summary: '',
  body: '',
  category: 'tech',
  imageUrl: '',
  imageAlt: '',
  imageCredit: '',
  imageSourceUrl: '',
  imageLicense: '',
  imageLicenseUrl: ''
};

test('createArticle rejects a title already used by a working or published article', async (t) => {
  let filter;
  mockTitleLookup(t, { _id: 'existing' }, (value) => { filter = value; });
  const create = t.mock.method(Article, 'create', async () => {
    throw new Error('A duplicate article should not be created');
  });

  await assert.rejects(service.createArticle(user, content), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'DUPLICATE_TITLE');
    return true;
  });

  assert.equal(create.mock.callCount(), 0);
  assert.equal(filter.$or.length, 2);
  const workingCopyPattern = filter.$or[0]['workingCopy.title'];
  assert.equal(workingCopyPattern.$options, 'i');
  assert.equal(new RegExp(workingCopyPattern.$regex, 'i').test('  BREAKING   NEWS  '), true);
  assert.ok(filter.$or[1]['publishedVersion.title']);
});

test('saveDraft rejects a duplicate before creating an autosaved draft', async (t) => {
  t.mock.method(Article, 'findById', async () => null);
  mockTitleLookup(t, { _id: 'existing' });
  const create = t.mock.method(Article, 'create', async () => {
    throw new Error('A duplicate draft should not be created');
  });

  await assert.rejects(service.saveDraft('abcdefabcdefabcdefabcdef', user, content), {
    code: 'DUPLICATE_TITLE'
  });
  assert.equal(create.mock.callCount(), 0);
});

test('updateArticle rejects a title already used by another article', async (t) => {
  const article = {
    _id: 'abcdefabcdefabcdefabcdef',
    authorId: user._id,
    workflowStatus: 'draft',
    workingCopy: { title: 'Old title' },
    save: t.mock.fn()
  };
  t.mock.method(Article, 'findById', async () => article);
  const findOne = mockTitleLookup(t, { _id: 'existing' });

  await assert.rejects(service.updateArticle(article._id, user, content), {
    code: 'DUPLICATE_TITLE'
  });
  assert.equal(findOne.mock.calls[0].arguments[0]._id.$ne, article._id);
  assert.equal(article.save.mock.callCount(), 0);
});

test('submitting a legacy draft with a duplicate title is blocked', async (t) => {
  const article = {
    _id: 'abcdefabcdefabcdefabcdef',
    authorId: user._id,
    workflowStatus: 'draft',
    workingCopy: { title: 'Breaking News' },
    save: t.mock.fn()
  };
  t.mock.method(Article, 'findById', async () => article);
  mockTitleLookup(t, { _id: 'existing' });

  await assert.rejects(service.transitionArticle(article._id, user, 'submit'), {
    code: 'DUPLICATE_TITLE'
  });
  assert.equal(article.save.mock.callCount(), 0);
});
