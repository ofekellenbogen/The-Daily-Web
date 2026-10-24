const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const app = require('../../app');
const weatherService = require('../../src/services/weather.service');
const locationService = require('../../src/services/location.service');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  weatherService.clearCache();
  // No real IP lookup during tests.
  mock.method(locationService, 'getServerLocation', async () => weatherService.DEFAULT_COORDS);
});
afterEach(() => mock.restoreAll());

after(async () => {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
});

test('GET /api/weather returns the weather payload with cache headers', async () => {
  mock.method(weatherService, 'getWeather', async () => ({ city: 'רעננה, ישראל', temperature: 26, hourly: [], daily: [] }));

  const res = await fetch(`${baseUrl}/api/weather`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.weather.temperature, 26);
});

test('GET /api/weather?refresh=true forces a refresh', async () => {
  let forced = null;
  mock.method(weatherService, 'getWeather', async ({ forceRefresh }) => {
    forced = forceRefresh;
    return { temperature: 24 };
  });
  const res = await fetch(`${baseUrl}/api/weather?refresh=true`);
  assert.equal(res.status, 200);
  assert.equal(forced, true);
});

test('GET /api/weather returns 503 when the service fails', async () => {
  mock.method(weatherService, 'getWeather', async () => { throw new Error('down'); });
  const res = await fetch(`${baseUrl}/api/weather`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).success, false);
});
