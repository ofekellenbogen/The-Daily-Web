const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(fetch, overviewFetch) {
  function element() {
    return {
      children: [], listeners: {}, attributes: {}, value: '', hidden: false, disabled: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      setCustomValidity(message) { this.validationMessage = message; },
      scrollIntoView() {}, reportValidity() { return true; }
    };
  }
  const ids = ['filter', 'article', 'suggestions', 'search-status', 'start', 'end', 'submit', 'status', 'result',
    'title', 'total', 'publication-count', 'interval', 'publications', 'chart',
    'overview', 'scope', 'states', 'history', 'event-key', 'article-count',
    'state-draft', 'state-pending', 'state-published', 'state-returned'];
  const elements = Object.fromEntries(ids.map((id) => [`analytics-${id}`, element()]));
  const charts = [];
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/js/analytics.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id], createElement: element },
    fetch: (url, options) => url.includes('/overview?')
      ? (overviewFetch ? overviewFetch(url, options) : Promise.resolve(response({ ...data(), article: null,
        counts: { draft: 0, pending: 0, published: 0, returned: 0 }, articleCount: 0, publicationCount: 0 })))
      : fetch(url, options), URLSearchParams, AbortController, Intl, Date,
    setTimeout(callback, delay) { assert.equal(delay, 250); timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Chart: function (canvas, config) { charts.push(config); this.destroy = () => {}; }
  });
  return { elements, charts,
    submit: () => elements['analytics-filter'].listeners.submit({ preventDefault() {} }),
    async search(text) {
      elements['analytics-article'].value = text;
      elements['analytics-article'].listeners.input();
      await this.runTimers();
    },
    async runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      await Promise.all(callbacks.map((callback) => callback()));
    },
    choose(index = 0) { elements['analytics-suggestions'].children[index].listeners.click(); }
  };
}

function response(data, ok = true) { return { ok, json: async () => data }; }
function data(title = 'News') {
  return { article: { title }, start: '2026-10-20', end: '2026-10-20', intervalMinutes: 5, total: 3,
    points: [{ time: '2026-10-20T00:00:00Z', views: 3 }],
    publications: [{ version: 2, publishedAt: '2026-10-20T00:07:00Z' }] };
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }

test('search fetches only one page before rendering the selected article', async () => {
  const requests = [];
  const page = setup(async (url) => {
    requests.push(url);
    return response(url.includes('articles?')
      ? { articles: [{ id: 'first', title: 'Published' }], nextPage: 2 }
      : data());
  });
  assert.equal(requests.length, 0);
  await page.search('Published');
  assert.deepEqual(requests, ['/api/analytics/articles?q=Published']);
  assert.equal(page.elements['analytics-suggestions'].children.length, 1);
  page.choose();
  page.elements['analytics-start'].value = '2026-10-20';
  page.elements['analytics-end'].value = '2026-10-20';
  await page.submit();
  assert.match(requests[1], /articles\/first\?start=2026-10-20&end=2026-10-20/);
  assert.equal(page.elements['analytics-title'].textContent, 'News');
  assert.equal(page.elements['analytics-result'].hidden, false);
  assert.equal(page.charts.at(-1).data.datasets[0].data[0].y, 3);
  assert.equal(page.charts.at(-1).options.plugins.publicationMarkers.events[0].publishedAt, '2026-10-20T00:07:00Z');
  const publication = page.elements['analytics-publications'].children[0];
  assert.equal(publication.children[0].textContent, 'עדכון גרסה 2');
  assert.equal(publication.children[1].dateTime, '2026-10-20T00:07:00Z');
  assert.equal(page.charts.at(-1).options.scales.x.ticks.stepSize, 21600000);
  const scale = {};
  page.charts.at(-1).options.scales.x.afterBuildTicks(scale);
  assert.equal(scale.ticks.length, 5);
  assert.equal(scale.ticks[1].value, Date.parse('2026-10-20T06:00:00Z'));
});

test('typing debounces searches, cancels older requests and ignores late responses', async () => {
  const pending = [];
  const page = setup((url, options) => new Promise((resolve) => pending.push({ url, options, resolve })));
  const input = page.elements['analytics-article'];
  input.value = 'N';
  input.listeners.input();
  input.value = 'News';
  input.listeners.input();
  assert.equal(pending.length, 0);
  const first = page.runTimers();
  assert.equal(pending.length, 1);
  assert.match(pending[0].url, /q=News$/);
  const second = page.search('Latest');
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve(response({ articles: [{ id: 'latest', title: 'Latest' }], nextPage: null }));
  await second;
  pending[0].resolve(response({ articles: [{ id: 'old', title: 'Old' }], nextPage: null }));
  await first;
  assert.equal(page.elements['analytics-suggestions'].children[0].textContent, 'Latest');
});

test('focus loads recent articles, keyboard selects them and typing invalidates the old selection', async () => {
  const page = setup(async () => response({ articles: [{ id: 'first', title: 'News' }], nextPage: null }));
  const input = page.elements['analytics-article'];
  input.listeners.focus();
  await flush();
  input.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(input.attributes['aria-activedescendant'], 'analytics-option-0');
  input.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(input.value, 'News');
  assert.equal(page.elements['analytics-submit'].disabled, false);
  assert.equal(page.elements['analytics-suggestions'].hidden, true);
  input.value = 'Other';
  input.listeners.input();
  assert.equal(page.elements['analytics-submit'].disabled, false);
  assert.equal(page.elements['analytics-result'].hidden, true);
});

test('slower old analytics responses cannot overwrite a newer selection', async () => {
  const pending = [];
  const page = setup((url) => url.includes('articles?')
    ? Promise.resolve(response({ articles: [{ id: 'first', title: 'News' }], nextPage: null }))
    : new Promise((resolve) => pending.push(resolve)));
  await page.search('News');
  page.choose();
  const first = page.submit();
  const second = page.submit();
  pending[1](response(data('Latest')));
  await second;
  pending[0](response(data('Outdated')));
  await first;
  assert.equal(page.elements['analytics-title'].textContent, 'Latest');
  assert.equal(page.charts.length, 2);
});

test('invalid ranges do not fetch and failed analytics requests hide stale results', async () => {
  let requests = 0;
  const page = setup(async (url) => {
    requests += 1;
    return url.includes('articles?') ? response({ articles: [{ id: 'first', title: 'News' }], nextPage: null })
      : response({ error: { message: 'Server error' } }, false);
  });
  await page.search('News');
  page.choose();
  page.elements['analytics-start'].value = '2026-10-21';
  page.elements['analytics-end'].value = '2026-10-20';
  await page.submit();
  assert.equal(requests, 1);
  page.elements['analytics-start'].value = '2026-10-20';
  await page.submit();
  assert.equal(page.elements['analytics-status'].textContent, 'Server error');
  assert.equal(page.elements['analytics-result'].hidden, true);
});

test('failed article searches recover on typing and empty analytics are visible', async () => {
  let attempts = 0;
  const page = setup(async (url) => {
    if (url.includes('articles?')) {
      attempts += 1;
      if (attempts === 1) throw new Error('Network error');
      return response({ articles: [{ id: 'first', title: 'News' }], nextPage: null });
    }
    return response({ ...data(), total: 0, publications: [] });
  });
  await page.search('News');
  assert.equal(page.elements['analytics-search-status'].textContent, 'Network error');
  await page.search('News');
  page.choose();
  await page.submit();
  assert.equal(page.elements['analytics-result'].hidden, false);
  assert.ok(page.elements['analytics-status'].textContent.length > 0);
  assert.equal(page.charts.length, 3);
});

test('empty matches and Escape or blur keep suggestions closed despite late responses', async () => {
  let finish;
  const page = setup(() => new Promise((resolve) => { finish = resolve; }));
  const first = page.search('Missing');
  finish(response({ articles: [], nextPage: null }));
  await first;
  assert.equal(page.elements['analytics-suggestions'].hidden, true);
  assert.ok(page.elements['analytics-search-status'].textContent.length > 0);
  for (const close of [() => page.elements['analytics-article'].listeners.keydown({ key: 'Escape', preventDefault() {} }),
    () => page.elements['analytics-article'].listeners.blur()]) {
    const search = page.search('News');
    close();
    finish(response({ articles: [{ id: 'first', title: 'News' }], nextPage: null }));
    await search;
    assert.equal(page.elements['analytics-suggestions'].hidden, true);
  }
});

test('ArrowUp starts at the last match and a click reopens a dismissed picker', async () => {
  const page = setup(async () => response({ articles: [
    { id: 'first', title: 'News' }, { id: 'second', title: 'Other news' }
  ], nextPage: null }));
  await page.search('News');
  const input = page.elements['analytics-article'];
  input.listeners.keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(input.attributes['aria-activedescendant'], 'analytics-option-1');
  input.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(input.value, 'Other news');
  input.listeners.click();
  await flush();
  assert.equal(page.elements['analytics-suggestions'].hidden, false);
});

test('loads combined analytics on entry and restores it with the all-articles button', async () => {
  const requests = [];
  const page = setup(async () => response({ articles: [{ id: 'first', title: 'News' }] }), async (url) => {
    requests.push(url);
    return response({ ...data(), article: null, articleCount: 10, publicationCount: 7,
      counts: { draft: 4, pending: 2, published: 3, returned: 1 }, publications: [] });
  });
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(page.elements['analytics-state-draft'].textContent, '4');
  assert.equal(page.elements['analytics-article-count'].textContent, '10');
  assert.equal(page.elements['analytics-publication-count'].textContent, '7');
  assert.equal(page.elements['analytics-states'].hidden, false);
  assert.equal(page.elements['analytics-history'].hidden, true);
  await page.search('News');
  page.choose();
  page.elements['analytics-overview'].listeners.click();
  await flush();
  assert.equal(page.elements['analytics-article'].value, '');
  assert.equal(page.elements['analytics-states'].hidden, false);
  assert.equal(requests.length, 3);
});
