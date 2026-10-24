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
    'weather-track', 'weather-retry'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  // Like the real page: the details start hidden until data arrives.
  elements['weather-details'].hidden = true;
  const timers = [];
  const context = {
    document: { getElementById: (id) => elements[id] || null, createElement: element },
    fetch, Date, console, URLSearchParams,
    // Captured instead of really waiting: tests call the timer function themselves.
    setInterval: (fn, ms) => timers.push({ fn, ms })
  };
  if (navigator) context.navigator = navigator;
  vm.runInNewContext(script, context);
  return { elements, timers };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const sample = {
  city: 'תל אביב-יפו (מיקום ברירת מחדל)', temperature: 26, feelsLike: 28, tempMax: 27, tempMin: 18, humidity: 54, precipitation: 0,
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
  assert.equal(elements['weather-city'].textContent, 'תל אביב-יפו (מיקום ברירת מחדל)');

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

test('a failed reload keeps fresh weather on screen, but replaces weather 15+ minutes old with an error', async () => {
  for (const [ageMinutes, expectError] of [[10, false], [15, true]]) {
    let attempts = 0;
    const updatedAt = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
    const { elements, timers } = setup(async () => {
      attempts++;
      if (attempts === 1) return { ok: true, json: async () => ({ success: true, weather: { ...sample, updatedAt } }) };
      return { ok: false, status: 503, json: async () => ({}) };
    });
    await tick();
    timers[0].fn();
    await tick();
    assert.equal(elements['weather-error'].hidden, !expectError);
    assert.equal(elements['weather-details'].hidden, expectError);
  }
});

test('the ticker reloads itself every 5 minutes, keeping the reader location', async () => {
  const urls = [];
  const geolocation = {
    getCurrentPosition(success) { success({ coords: { latitude: 31.2518, longitude: 34.7913 } }); }
  };
  const { timers } = setup(async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  }, { geolocation });
  await tick();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5 * 60 * 1000);
  timers[0].fn();
  await tick();
  assert.equal(urls.at(-1), '/api/weather?lat=31.25&lon=34.79');
});

test('allowed location: weather is reloaded for the reader area and shows the town name', async () => {
  const urls = [];
  const geolocation = {
    getCurrentPosition(success) { success({ coords: { latitude: 31.2518, longitude: 34.7913 } }); }
  };
  const { elements } = setup(async (url) => {
    urls.push(url);
    const city = url.includes('lat=') ? 'באר-שבע, ישראל' : 'תל אביב-יפו (מיקום ברירת מחדל)';
    return { ok: true, json: async () => ({ success: true, weather: { ...sample, city } }) };
  }, { geolocation });
  await tick();
  assert.deepEqual(urls, ['/api/weather', '/api/weather?lat=31.25&lon=34.79']);
  assert.equal(elements['weather-city'].textContent, 'באר-שבע, ישראל');
});

test('refused location: only the default-location (Tel Aviv) weather is loaded', async () => {
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
