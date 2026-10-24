const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, '../../public/js/weather.js'), 'utf8');

function setup(fetch) {
  function element() {
    return {
      children: [], listeners: {}, hidden: false, disabled: false, textContent: '', dateTime: '', className: '', title: '',
      addEventListener(name, handler) { this.listeners[name] = handler; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }
    };
  }
  const ids = ['weather-loading', 'weather-details', 'weather-error', 'weather-error-msg', 'weather-city', 'weather-temp',
    'weather-icon', 'weather-desc', 'weather-feels', 'weather-max', 'weather-min', 'weather-precip', 'weather-wind',
    'weather-humidity', 'weather-hourly', 'weather-daily', 'weather-updated-time', 'weather-stale-badge',
    'weather-refresh', 'weather-retry'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  vm.runInNewContext(script, {
    document: { getElementById: (id) => elements[id] || null, createElement: element },
    fetch, Date, console
  });
  return { elements };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const sample = {
  city: 'רעננה, ישראל', temperature: 26, feelsLike: 28, tempMax: 27, tempMin: 18, humidity: 54, precipitation: 0,
  windSpeed: 12, description: 'בהיר', icon: '☀️', updatedAt: '2026-10-24T12:00:00.000Z', stale: false,
  hourly: [{ time: 'עכשיו', temperature: 26, icon: '☀️', description: 'בהיר' }, { time: '14:00', temperature: 28, icon: '☀️', description: 'בהיר' }],
  daily: [{ date: '2026-10-25', maxTemp: 27, minTemp: 19, icon: '⛅', description: 'מעונן חלקית' }]
};

test('weather.js renders the card, hourly and daily lists', async () => {
  const { elements } = setup(async (url) => {
    assert.equal(url, '/api/weather');
    return { ok: true, json: async () => ({ success: true, weather: sample }) };
  });
  await tick();

  assert.equal(elements['weather-details'].hidden, false);
  assert.equal(elements['weather-loading'].hidden, true);
  assert.equal(elements['weather-city'].textContent, 'רעננה, ישראל');
  assert.equal(elements['weather-temp'].textContent, 26);
  assert.equal(elements['weather-feels'].textContent, 28);
  assert.equal(elements['weather-max'].textContent, 27);
  assert.equal(elements['weather-precip'].textContent, '0%');
  assert.equal(elements['weather-wind'].textContent, '12 קמ"ש');
  assert.equal(elements['weather-humidity'].textContent, '54%');
  assert.equal(elements['weather-hourly'].children.length, 2);
  assert.equal(elements['weather-hourly'].children[0].children[0].textContent, 'עכשיו');
  assert.equal(elements['weather-daily'].children.length, 1);
  assert.equal(elements['weather-stale-badge'].hidden, true);
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
