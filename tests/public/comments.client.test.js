const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

const script = readFileSync(require.resolve('../../public/js/comments.js'), 'utf8');

function element() {
  return {
    children: [],
    dataset: {},
    listeners: {},
    classList: { toggle() {} },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...children) { this.children.push(...children); },
    prepend(child) { this.children.unshift(child); }
  };
}

function setup(fetch) {
  const section = element();
  section.dataset = { articleId: 'article-123', nextCursor: '' };
  const form = element();
  const submitButton = element();
  const nameInput = { value: '  Reader  ' };
  const bodyInput = { value: '  A useful comment  ', focus() {} };
  form.elements = { authorName: nameInput, body: bodyInput };
  form.querySelector = () => submitButton;
  const status = element();
  const list = element();
  const empty = { hidden: false };
  const count = { textContent: '3' };
  const more = element();
  const ids = {
    comments: section,
    'comment-form': form,
    'comment-status': status,
    'comment-list': list,
    'comments-empty': empty,
    'comments-count': count,
    'comments-more': more
  };
  let reloads = 0;

  vm.runInNewContext(script, {
    document: { getElementById: (id) => ids[id], createElement: element },
    fetch,
    window: { location: { reload() { reloads++; } } }
  });

  return { form, submitButton, nameInput, bodyInput, status, list, empty, count, get reloads() { return reloads; } };
}

test('successful comment submission updates the list and count without reloading', async () => {
  let request;
  const page = setup(async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ data: { authorName: 'Reader', body: 'A useful comment', createdAt: '2026-10-24T10:00:00.000Z' } })
    };
  });
  let prevented = false;

  await page.form.listeners.submit({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(request.url, '/api/articles/article-123/comments');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { authorName: 'Reader', body: 'A useful comment' });
  assert.equal(page.list.children.length, 1);
  assert.equal(page.list.children[0].children[1].textContent, 'A useful comment');
  assert.equal(page.count.textContent, '4');
  assert.equal(page.empty.hidden, true);
  assert.equal(page.bodyInput.value, '');
  assert.equal(page.reloads, 0);
});

test('failed comment submission keeps the draft and does not mutate the list', async () => {
  const page = setup(async () => ({
    ok: false,
    json: async () => ({ error: { message: 'Rate limited' } })
  }));

  await page.form.listeners.submit({ preventDefault() {} });

  assert.equal(page.bodyInput.value, '  A useful comment  ');
  assert.equal(page.list.children.length, 0);
  assert.equal(page.count.textContent, '3');
  assert.equal(page.status.textContent, 'Rate limited');
  assert.equal(page.submitButton.disabled, false);
});