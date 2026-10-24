const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const script = readFileSync(require.resolve('../../public/js/editor-view.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(fetch, hasSnapshot = true) {
  const ids = {};
  function element() {
    return { children: [], listeners: {}, attributes: {}, dataset: {}, textContent: '',
      set id(value) { ids[value] = this; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return key === 'src' ? this.src || null : this.attributes[key]; },
      removeAttribute(key) { if (key === 'src') delete this.src; delete this.attributes[key]; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }, after() {} };
  }
  const editor = element(); editor.dataset = { articleId: 'article-id', workflowStatus: 'pending' };
  const image = element(), caption = element(), preview = element(), input = element(), altInput = element(), feedback = element();
  input.value = ''; altInput.value = '';
  preview.querySelector = tag => tag === 'img' ? image : caption;
  editor.querySelector = () => element();
  Object.assign(ids, { 'article-editor': editor, 'article-image': input, 'article-image-alt': altInput, 'draft-image-preview': preview, 'snapshot-status': feedback });
  if (hasSnapshot) ids['approved-snapshot'] = element();
  let observer;
  vm.runInNewContext(script, {
    document: { currentScript: { dataset: { initialStatus: 'pending', role: 'editor' } },
      getElementById: id => ids[id], createElement: element, addEventListener() {} },
    URL, fetch,
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }
  });
  return { ids, input, altInput, image, preview, caption, editor, observer, feedback };
}
test('preview reacts immediately to new, replaced, empty and invalid image URLs', () => {
  const page = setup(() => { throw new Error('No server request needed'); });
  assert.equal(page.preview.hidden, true);
  page.input.value = 'https://example.com/first.jpg'; page.input.listeners.input();
  assert.equal(page.image.src, page.input.value); assert.equal(page.preview.hidden, false);
  page.altInput.value = 'City hall'; page.altInput.listeners.input();
  assert.equal(page.image.alt, 'City hall');
  page.input.value = 'https://example.com/second.jpg'; page.input.listeners.input();
  assert.equal(page.image.src, page.input.value);
  page.image.listeners.error(); assert.equal(page.image.hidden, true);
  assert.match(page.caption.textContent, /לא ניתן/);
  for (const value of ['', 'not-a-url', 'javascript:alert(1)']) {
    page.input.value = value; page.input.listeners.input();
    assert.equal(page.preview.hidden, true); assert.equal(page.image.src, undefined);
  }
  page.input.value = '/article-images/0123456789abcdef01234567.svg'; page.input.listeners.input();
  assert.equal(page.preview.hidden, false);
  assert.equal(page.image.src, page.input.value);
});
test('approval refreshes the snapshot from the server once, including first publication', async () => {
  for (const existing of [true, false]) {
    const urls = [];
    const page = setup(async url => {
      urls.push(url); return { ok: true, json: async () => ({ data: { version: 2, categoryLabel: 'טכנולוגיה', title: '<script>not HTML</script>', summary: 'Latest', body: 'Approved content', imageUrl: 'https://example.com/published.jpg', imageAlt: 'A technology illustration' } }) };
    }, existing);
    page.observer(); assert.equal(urls.length, 0);
    page.editor.dataset.workflowStatus = 'published'; page.observer(); await tick();
    const panel = page.ids['approved-snapshot'];
    assert.equal(urls[0], '/api/staff/articles/article-id/published');
    assert.equal(panel.children[2].textContent, '<script>not HTML</script>');
    assert.equal(panel.children[4].src, 'https://example.com/published.jpg');
    assert.equal(panel.children[5].children[0].textContent, 'Approved content');
    page.observer(); await tick(); assert.equal(urls.length, 1);
  }
});
test('failed snapshot refresh provides a retry without repeating publication', async () => {
  let fail = true;
  const page = setup(async () => {
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ data: { version: 1, title: 'Published', categoryLabel: 'עולם', summary: '', body: '', imageUrl: '', imageAlt: '' } }) };
  });
  page.editor.dataset.workflowStatus = 'published'; page.observer(); await tick();
  assert.match(page.feedback.textContent, /הפרסום הצליח/);
  fail = false; await page.feedback.children[0].listeners.click();
  assert.equal(page.ids['approved-snapshot'].children[2].textContent, 'Published');
});
