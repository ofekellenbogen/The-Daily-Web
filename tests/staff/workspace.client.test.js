const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real client script with only the DOM methods it needs.
function setup(fetch, pathname = '/editor') {
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
  list.append(element());
  const more = element();
  more.dataset.nextPage = '2';
  const message = element();
  const filter = element();
  filter.elements = { status: { ...element(), value: 'pending' } };
  const elements = { 'workspace-articles': list, 'workspace-more': more, 'workspace-status': message, 'workspace-filter': filter };
  const urls = [];
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/js/workspace.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id], createElement: element },
    fetch, URLSearchParams,
    window: {
      location: { pathname },
      history: { replaceState: (state, title, url) => urls.push(url) }
    }
  });
  return { list, more, message, filter, urls };
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
  assert.equal(card.children[0].children[0].textContent, 'latest');
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

test('reporter workspace filters by status and does not render author label', async () => {
  const requests = [];
  const page = setup(async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({
        articles: [
          { _id: 'art-1', workingCopy: { title: 'טיוטה ראשונה' }, workflowStatus: 'draft', editorNote: '' },
          { _id: 'art-2', workingCopy: { title: 'הוחזרה' }, workflowStatus: 'returned', editorNote: 'נא לתקן כותרת' }
        ],
        nextPage: null,
        statusLabels: { draft: 'בהכנה', returned: 'הוחזרה לתיקונים' }
      })
    };
  }, '/reporter');

  page.filter.elements.status.value = 'returned';
  await page.filter.elements.status.listeners.change();

  assert.equal(requests[0], '/api/staff/articles?page=1&status=returned');
  assert.equal(page.urls[0], '/reporter?status=returned');
  assert.equal(page.list.children.length, 2);

  const card1 = page.list.children[0].children[0];
  assert.equal(card1.children[0].children[0].textContent, 'טיוטה ראשונה');
  assert.equal(card1.children[1].textContent, 'מצב: בהכנה');
  // In reporter view, no "כתב: ..." paragraph should be present
  assert.equal(card1.children.some((c) => c.textContent?.startsWith('כתב:')), false);

  const card2 = page.list.children[1].children[0];
  assert.equal(card2.children[0].children[0].textContent, 'הוחזרה');
  assert.equal(card2.children[1].textContent, 'מצב: הוחזרה לתיקונים');
  assert.equal(card2.children[2].textContent, 'הערת עורך: נא לתקן כותרת');
});

