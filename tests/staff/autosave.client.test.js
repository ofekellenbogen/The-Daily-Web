const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const script = readFileSync(require.resolve('../../public/js/autosave.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(fetch, storage = new Map(), fresh = false, options = {}) {
  const handlers = {}, events = {};
  const fieldset = { disabled: false };
  const form = { elements: {}, querySelector: () => fieldset, after() {},
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const badge = {}, status = { classList: { toggle() {} } };
  const actions = Object.fromEntries((options.actions || []).map(action => [action, {
    dataset: { action }, addEventListener(name, handler) { this[name] = handler; }
  }]));
  const editor = { dataset: { articleId: fresh ? '' : '123456789012345678901234', userId: 'writer',
    role: options.role || 'reporter', workflowStatus: options.workflowStatus || 'draft' },
    querySelector: () => ({}), querySelectorAll: () => Object.values(actions) };
  let content = {
    title: 'First', summary: '', body: '', category: 'tech', imageUrl: '', imageAlt: '',
    imageCredit: '', imageSourceUrl: '', imageLicense: '', imageLicenseUrl: ''
  };
  const elements = { 'article-editor': editor, 'article-form': form, 'staff-status': status, 'article-state': badge };
  vm.runInNewContext(script, {
    document: { getElementById: id => elements[id] }, fetch, crypto: require('node:crypto').webcrypto,
    FormData: function () { return Object.entries(content); },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    window: { addEventListener: (name, fn) => { events[name] = fn; }, setInterval() {}, history: { replaceState() {} } }
  });
  return { handlers, events, storage, status, editor, actions, change(title) { content.title = title; handlers.input(); } };
}

test('editors can publish from draft and returned states, and after autosaving a published update', async () => {
  for (const workflowStatus of ['draft', 'returned', 'published']) {
    const requests = [];
    let resolveSave;
    const page = setup((url, options) => {
      requests.push({ url, ...options });
      if (options.method === 'PUT') return new Promise(resolve => { resolveSave = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ message: 'Published' }) });
    }, new Map(), false, { role: 'editor', workflowStatus, actions: ['approve', 'return', 'delete'] });
    assert.equal(page.actions.approve.hidden, workflowStatus === 'published');
    assert.equal(page.actions.return.hidden, true);
    page.change('Editor changes');
    resolveSave({ ok: true, json: async () => ({ workflowStatus: workflowStatus === 'returned' ? 'returned' : 'draft' }) });
    await tick();
    assert.equal(page.actions.approve.hidden, false);
    assert.equal(page.actions.return.hidden, true);
    // Clicking publish must save the current form before sending approval.
    const publishing = page.actions.approve.click();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'PUT');
    assert.equal(JSON.parse(requests[1].body).title, 'Editor changes');
    resolveSave({ ok: true, json: async () => ({ workflowStatus: workflowStatus === 'returned' ? 'returned' : 'draft' }) });
    await publishing;
    assert.equal(requests.length, 3);
    assert.equal(requests[2].method, 'POST');
    assert.match(requests[2].url, /\/approve$/);
    assert.equal(page.editor.dataset.workflowStatus, 'published');
    assert.equal(page.actions.approve.hidden, true);
    assert.equal(page.actions.delete.hidden, false);
  }
});

test('a failed editor save prevents publication and keeps publish available for retry', async () => {
  const requests = [];
  const page = setup(async (url, options) => {
    requests.push({ url, ...options });
    throw new Error('offline');
  }, new Map(), false, { role: 'editor', actions: ['approve'] });
  await page.actions.approve.click();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(page.editor.dataset.workflowStatus, 'draft');
  assert.equal(page.actions.approve.hidden, false);
  assert.equal(page.actions.approve.disabled, false);
  assert.match(page.status.textContent, /offline/);
  assert.equal(page.storage.size, 1);
});

test('autosave serializes requests and saves the latest text typed during an in-flight save', async () => {
  const requests = [], resolves = [];
  const page = setup((url, options) => {
    requests.push(JSON.parse(options.body)); return new Promise(resolve => resolves.push(resolve));
  });
  page.change('First'); page.change('Second'); page.change('Newest');
  assert.equal(requests.length, 1);
  resolves[0]({ ok: true, json: async () => ({ workflowStatus: 'draft' }) });
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].title, 'Newest');
  resolves[1]({ ok: true, json: async () => ({ workflowStatus: 'draft' }) });
  await tick();
  assert.equal(page.storage.size, 0);
  assert.equal(page.status.textContent, 'כל השינויים נשמרו');
});
test('network failure preserves unsent content and warns before closing; online retries it', async () => {
  let fail = true;
  const page = setup(async () => {
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ workflowStatus: 'draft' }) };
  });
  page.change('Unsent'); await tick();
  assert.equal(page.storage.size, 1);
  let warned = false;
  page.events.beforeunload({ preventDefault() { warned = true; } });
  assert.equal(warned, true);
  fail = false; page.events.online(); await tick();
  assert.equal(page.storage.size, 0);
});

test('manual Save and autosave send the same content through the same PUT endpoint', async () => {
  const requests = [];
  const page = setup(async (url, options) => {
    requests.push({ url, method: options.method, body: options.body });
    return { ok: true, json: async () => ({ workflowStatus: 'draft' }) };
  });
  page.change('Shared save mechanism'); await tick();
  let prevented = false;
  page.handlers.submit({ preventDefault() { prevented = true; } }); await tick();
  assert.equal(prevented, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'PUT');
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(page.status.textContent, 'כל השינויים נשמרו');
});

test('a new draft moves unsent backup to its permanent URL key after the first save', async () => {
  const resolves = [], urls = [];
  const page = setup(url => { urls.push(url); return new Promise(resolve => resolves.push(resolve)); }, new Map(), true);
  page.change('First'); page.change('Still typing');
  resolves[0]({ ok: true, json: async () => ({ workflowStatus: 'draft' }) }); await tick();
  assert.equal(urls[0], urls[1]);
  const draftId = urls[0].split('/').at(-1);
  assert.ok(page.storage.has(`dailyweb:draft:writer:${draftId}`));
  assert.equal(page.storage.has('dailyweb:draft:writer:new'), false);
  resolves[1]({ ok: true, json: async () => ({ workflowStatus: 'draft' }) }); await tick();
  assert.equal(page.storage.size, 0);
});
