const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real client script with only the DOM methods it needs.
function setup(fetch, role = 'editor') {
  function element() {
    return {
      children: [], dataset: {}, listeners: {},
      classList: { add() {}, remove() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      addEventListener(name, handler) { this.listeners[name] = handler; }
    };
  }
  const list = element();
  list.dataset.role = role;
  list.append(element());
  const more = element();
  more.dataset.nextPage = '2';
  const message = element();
  const filter = element();
  filter.elements = { status: { ...element(), value: 'pending' }, q: { ...element(), value: '' } };
  const elements = { 'workspace-articles': list, 'workspace-more': more, 'workspace-status': message, 'workspace-filter': filter };
  const urls = [];
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/js/workspace.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id], createElement: element },
    fetch, URLSearchParams, AbortController,
    setTimeout(fn, delay) { assert.equal(delay, 350); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    window: {
      location: { pathname: `/${role}` },
      history: { replaceState: (state, title, url) => urls.push(url) }
    }
  });
  return { list, more, message, filter, urls, timers,
    search(value) { filter.elements.q.value = value; filter.elements.q.listeners.input(); },
    runSearch() { const fn = [...timers.values()].at(-1); assert.ok(fn); timers.clear(); return fn(); }
  };
}

function result(id, nextPage = null) {
  return {
    ok: true,
    json: async () => ({
      articles: [{ _id: id, workingCopy: { title: id }, workflowStatus: 'pending', authorId: { displayName: 'Reporter' } }],
      nextPage, statusLabels: { pending: 'ממתינה לאישור עורך' }
    })
  };
}

test('status filtering replaces the list and load-more keeps the filter without navigation', async () => {
  const requests = [];
  const page = setup(async (url) => {
    requests.push(url);
    return result(requests.length === 1 ? 'first' : 'second', requests.length === 1 ? 2 : null);
  });
  await page.filter.elements.status.listeners.change();
  assert.equal(requests[0], '/api/staff/articles?page=1&status=pending');
  assert.equal(page.list.children.length, 1);
  assert.equal(page.more.hidden, false);
  assert.equal(page.urls[0], '/editor?status=pending');
  await page.more.listeners.click();
  assert.equal(requests[1], '/api/staff/articles?page=2&status=pending');
  assert.equal(page.list.children.length, 2);
  assert.equal(page.more.hidden, true);
  assert.equal(page.more.disabled, false);
});

test('a slower old filter response cannot overwrite the latest selection', async () => {
  const responses = [];
  const page = setup(() => new Promise((resolve) => responses.push(resolve)));
  const first = page.filter.elements.status.listeners.change();
  page.filter.elements.status.value = 'published';
  const second = page.filter.elements.status.listeners.change();
  responses[1](result('latest'));
  await second;
  responses[0](result('outdated'));
  await first;
  const card = page.list.children[0].children[0];
  const heading = card.children.find((child) => child.children?.[0]?.textContent === 'latest');
  assert.ok(heading);
  assert.equal(heading.children[0].textContent, 'latest');
  assert.equal(page.urls.at(-1), '/editor?status=published');
});

test('a failed filter preserves the list and displays the server error', async () => {
  const page = setup(async () => ({ ok: false, json: async () => ({ error: { message: 'יש להתחבר' } }) }));
  const original = page.list.children[0];
  await page.filter.elements.status.listeners.change();
  assert.equal(page.list.children[0], original);
  assert.equal(page.message.textContent, 'יש להתחבר');
  assert.equal(page.more.disabled, false);
});

test('title search debounces typing and keeps the query and status during pagination for both roles', async () => {
  for (const role of ['editor', 'reporter']) {
    const requests = [];
    const page = setup(async url => {
      requests.push(url);
      return result(`article-${requests.length}`, requests.length === 1 ? 2 : null);
    }, role);
    page.search('n'); page.search('ne'); page.search(' news ');
    assert.equal(requests.length, 0);
    assert.equal(page.timers.size, 1);
    assert.equal(page.more.disabled, true);
    await page.runSearch();
    assert.equal(requests[0], '/api/staff/articles?page=1&status=pending&q=news');
    assert.equal(page.urls.at(-1), `/${role}?status=pending&q=news`);
    await page.more.listeners.click();
    assert.equal(requests[1], '/api/staff/articles?page=2&status=pending&q=news');
    assert.equal(page.list.children.length, 2);
    const paragraphs = page.list.children[0].children[0].children.filter(child => child.textContent?.startsWith('כתב:'));
    assert.equal(paragraphs.length, role === 'editor' ? 1 : 0);
  }
});

test('typing cancels an older request immediately and ignores its response during the debounce', async () => {
  const requests = [];
  const page = setup((url, options) => new Promise(resolve => requests.push({ options, resolve })));
  const original = page.list.children[0];
  const first = page.filter.elements.status.listeners.change();
  page.search('latest');
  assert.equal(requests[0].options.signal.aborted, true);
  requests[0].resolve(result('outdated'));
  await first;
  assert.equal(page.list.children[0], original);
  assert.equal(page.more.disabled, true);
  const second = page.runSearch();
  requests[1].resolve(result('latest'));
  await second;
  assert.equal(page.list.children.length, 1);
  assert.match(page.urls.at(-1), /q=latest/);
});

test('status changes and Enter apply the current search immediately without a duplicate delayed request', async () => {
  const requests = [];
  const page = setup(async url => { requests.push(url); return result('match'); });
  page.search('updated');
  page.filter.elements.status.value = 'returned';
  await page.filter.elements.status.listeners.change();
  assert.equal(page.timers.size, 0);
  assert.equal(requests[0], '/api/staff/articles?page=1&status=returned&q=updated');
  page.search('');
  page.filter.elements.status.value = '';
  let prevented = false;
  await page.filter.listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.timers.size, 0);
  assert.equal(requests[1], '/api/staff/articles?page=1');
  assert.equal(page.urls.at(-1), '/editor');
});

test('load-more does not send duplicate requests while a page is loading', async () => {
  let resolvePage;
  let count = 0;
  const page = setup(() => { count++; return new Promise(resolve => { resolvePage = resolve; }); });
  const pending = page.more.listeners.click();
  await page.more.listeners.click();
  assert.equal(count, 1);
  resolvePage(result('next'));
  await pending;
  assert.equal(page.list.children.length, 2);
});
