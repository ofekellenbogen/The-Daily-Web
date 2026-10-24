const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, '../../public/js/weather.js'), 'utf8');

function setup(fetch, navigator) {
  function element() {
    return {
      children: [], listeners: {}, attributes: {}, hidden: false, disabled: false, textContent: '', dateTime: '', className: '', title: '',
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(key, value) { this.attributes[key] = value; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }
    };
  }
  const ids = ['weather-loading', 'weather-details', 'weather-error', 'weather-error-msg', 'weather-city',
    'weather-track', 'weather-refresh', 'weather-retry'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  // Like the real page: the details start hidden until data arrives.
  elements['weather-details'].hidden = true;
  const context = {
    document: { getElementById: (id) => elements[id] || null, createElement: element },
    fetch, Date, console, URLSearchParams
  };
  if (navigator) context.navigator = navigator;
  vm.runInNewContext(script, context);
  return { elements };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const sample = {
  city: 'רעננה, ישראל', temperature: 26, feelsLike: 28, tempMax: 27, tempMin: 18, humidity: 54, precipitation: 0,
  windSpeed: 12, description: 'בהיר', icon: '☀️', updatedAt: '2026-10-24T12:00:00.000Z', stale: false,
  hourly: [{ time: 'עכשיו', temperature: 26, icon: '☀️', description: 'בהיר' }, { time: '14:00', temperature: 28, icon: '☀️', description: 'בהיר' }],
  daily: [{ date: '2026-10-25', maxTemp: 27, minTemp: 19, icon: '⛅', description: 'מעונן חלקית' }]
};

// Collects all visible text of a fake element tree.
function text(node) {
  return [node.textContent, ...(node.children || []).map(text)].join(' ');
}

test('weather.js fills the ticker with current, hourly and daily items, twice for a seamless loop', async () => {
  const { elements } = setup(async (url) => {
    assert.equal(url, '/api/weather');
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  });
  await tick();

  assert.equal(elements['weather-details'].hidden, false);
  assert.equal(elements['weather-loading'].hidden, true);
  assert.equal(elements['weather-city'].textContent, 'רעננה, ישראל');

  const [original, copy] = elements['weather-track'].children;
  // 6 current-condition items + 2 hours + 1 day + "updated"
  assert.equal(original.children.length, 10);
  assert.equal(copy.children.length, 10);
  assert.equal(original.attributes['aria-hidden'], undefined);
  assert.equal(copy.attributes['aria-hidden'], 'true');

  const all = text(original);
  for (const expected of ['☀️ 26°', 'בהיר', 'מורגש כ-28°', '↑ 27°', '↓ 18°', 'משקעים 0%', 'רוח 12 קמ"ש', 'לחות 54%', 'עכשיו', '27° / 19°']) {
    assert.ok(all.includes(expected), `missing "${expected}"`);
  }
  assert.ok(!all.includes('נתונים שמורים'));
});

test('stale data shows the "saved data" badge', async () => {
  const { elements } = setup(async () => ({ ok: true, json: async () => ({ success: true, weather: { ...sample, stale: true } }) }));
  await tick();
  assert.ok(text(elements['weather-track'].children[0]).includes('נתונים שמורים'));
});

test('weather.js shows an error and retries successfully', async () => {
  let attempts = 0;
  const { elements } = setup(async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  });
  await tick();
  assert.equal(elements['weather-error'].hidden, false);
  assert.equal(elements['weather-details'].hidden, true);

  elements['weather-retry'].listeners.click();
  await tick();
  assert.equal(attempts, 2);
  assert.equal(elements['weather-details'].hidden, false);
  assert.equal(elements['weather-error'].hidden, true);
});

test('refresh button requests ?refresh=true', async () => {
  const urls = [];
  const { elements } = setup(async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  });
  await tick();
  elements['weather-refresh'].listeners.click();
  await tick();
  assert.deepEqual(urls, ['/api/weather', '/api/weather?refresh=true']);
});

test('allowed location: weather is reloaded for the reader area with rounded coordinates', async () => {
  const urls = [];
  const geolocation = {
    getCurrentPosition(success) { success({ coords: { latitude: 31.2518, longitude: 34.7913 } }); }
  };
  const { elements } = setup(async (url) => {
    urls.push(url);
    const city = url.includes('lat=') ? 'המיקום שלך' : 'תל אביב-יפו, ישראל';
    return { ok: true, json: async () => ({ success: true, weather: { ...sample, city } }) };
  }, { geolocation });
  await tick();
  assert.deepEqual(urls, ['/api/weather', '/api/weather?lat=31.3&lon=34.8']);
  assert.equal(elements['weather-city'].textContent, 'המיקום שלך');
  // Refresh keeps using the reader's location.
  elements['weather-refresh'].listeners.click();
  await tick();
  assert.equal(urls[2], '/api/weather?lat=31.3&lon=34.8&refresh=true');
});

test('refused location: only the server-location weather is loaded', async () => {
  const urls = [];
  const geolocation = { getCurrentPosition(success, error) { error({ code: 1 }); } };
  const { elements } = setup(async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  }, { geolocation });
  await tick();
  assert.deepEqual(urls, ['/api/weather']);
  assert.equal(elements['weather-details'].hidden, false);
});
