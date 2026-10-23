const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const app = require('../../app');
const weatherService = require('../../src/modules/weather/weather.service');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  weatherService.clearCache();
});

afterEach(() => {
  mock.restoreAll();
});

after(async () => {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
});

test('GET /api/weather returns 200 with formatted weather payload and cache headers', async () => {
  mock.method(weatherService, 'getWeather', async () => ({
    city: 'תל אביב',
    temperature: 23,
    windSpeed: 14,
    weatherCode: 1,
    description: 'בהיר ברובו',
    icon: '🌤️',
    updatedAt: '2026-10-23T12:00:00.000Z',
    cached: true,
    stale: false
  }));

  const res = await fetch(`${baseUrl}/api/weather`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type').includes('application/json'), true);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');

  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.weather.city, 'תל אביב');
  assert.equal(json.weather.temperature, 23);
  assert.equal(json.weather.description, 'בהיר ברובו');
});

test('GET /api/weather?refresh=true requests a forced refresh', async () => {
  let requestedForce = null;
  mock.method(weatherService, 'getWeather', async ({ forceRefresh }) => {
    requestedForce = forceRefresh;
    return {
      city: 'תל אביב',
      temperature: 24,
      description: 'בהיר',
      icon: '☀️',
      updatedAt: '2026-10-23T12:05:00.000Z',
      cached: false
    };
  });

  const res = await fetch(`${baseUrl}/api/weather?refresh=true`);
  assert.equal(res.status, 200);
  assert.equal(requestedForce, true);
});

test('GET /api/weather returns 503 when weather service fails and no cache exists', async () => {
  mock.method(weatherService, 'getWeather', async () => {
    throw new Error('External service down');
  });

  const res = await fetch(`${baseUrl}/api/weather`);
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.equal(json.message, 'שירות מזג האוויר אינו זמין כעת');
});
