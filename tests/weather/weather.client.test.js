const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(fetch) {
  function element() {
    return {
      children: [],
      listeners: {},
      attributes: {},
      value: '',
      hidden: false,
      disabled: false,
      textContent: '',
      dateTime: '',
      addEventListener(name, handler) {
        this.listeners[name] = handler;
      }
    };
  }

  const ids = [
    'weather-loading',
    'weather-details',
    'weather-error',
    'weather-error-msg',
    'weather-temp',
    'weather-icon',
    'weather-desc',
    'weather-city',
    'weather-wind',
    'weather-updated-time',
    'weather-stale-badge',
    'weather-refresh',
    'weather-retry'
  ];

  const elements = Object.fromEntries(ids.map((id) => [id, element()]));

  vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/js/weather.js'), 'utf8'), {
    document: {
      getElementById: (id) => elements[id] || null
    },
    fetch,
    Date,
    console
  });

  return { elements };
}

test('weather.js displays weather details on successful API response', async () => {
  const mockFetch = async (url) => {
    assert.equal(url, '/api/weather');
    return {
      ok: true,
      json: async () => ({
        success: true,
        weather: {
          city: 'תל אביב',
          temperature: 26,
          windSpeed: 15,
          weatherCode: 0,
          description: 'בהיר',
          icon: '☀️',
          updatedAt: '2026-10-23T12:00:00.000Z',
          stale: false
        }
      })
    };
  };

  const { elements } = setup(mockFetch);
  // Wait for the async loadWeather invocation
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements['weather-details'].hidden, false);
  assert.equal(elements['weather-loading'].hidden, true);
  assert.equal(elements['weather-error'].hidden, true);

  assert.equal(elements['weather-temp'].textContent, 26);
  assert.equal(elements['weather-icon'].textContent, '☀️');
  assert.equal(elements['weather-desc'].textContent, 'בהיר');
  assert.equal(elements['weather-city'].textContent, 'תל אביב');
  assert.equal(elements['weather-wind'].textContent, 'רוח: 15 קמ"ש');
  assert.equal(elements['weather-stale-badge'].hidden, true);
});

test('weather.js shows error container and allows retry when fetch fails', async () => {
  let attempts = 0;
  const mockFetch = async (url) => {
    attempts++;
    if (attempts === 1) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ success: false })
      };
    }
    return {
      ok: true,
      json: async () => ({
        success: true,
        weather: {
          city: 'תל אביב',
          temperature: 22,
          description: 'מעונן',
          icon: '☁️',
          updatedAt: '2026-10-23T13:00:00.000Z'
        }
      })
    };
  };

  const { elements } = setup(mockFetch);
  await new Promise((resolve) => setImmediate(resolve));

  // Should show error state
  assert.equal(elements['weather-error'].hidden, false);
  assert.equal(elements['weather-details'].hidden, true);
  assert.equal(elements['weather-loading'].hidden, true);
  assert.equal(elements['weather-error-msg'].textContent.includes('שירות מזג האוויר אינו זמין'), true);

  // Click retry button
  assert.ok(elements['weather-retry'].listeners.click);
  elements['weather-retry'].listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  // Second attempt succeeded
  assert.equal(attempts, 2);
  assert.equal(elements['weather-details'].hidden, false);
  assert.equal(elements['weather-error'].hidden, true);
  assert.equal(elements['weather-temp'].textContent, 22);
});

test('clicking refresh button calls API with ?refresh=true', async () => {
  const requestedUrls = [];
  const mockFetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      json: async () => ({
        success: true,
        weather: {
          city: 'תל אביב',
          temperature: 24,
          description: 'בהיר',
          icon: '☀️',
          updatedAt: '2026-10-23T12:10:00.000Z'
        }
      })
    };
  };

  const { elements } = setup(mockFetch);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], '/api/weather');

  // Trigger refresh click
  elements['weather-refresh'].listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[1], '/api/weather?refresh=true');
});
