const test = require('node:test');
const assert = require('node:assert/strict');
const locationService = require('../../src/services/location.service');

test.beforeEach(() => locationService.clearLocationCache());

const json = (body) => ({ ok: true, json: async () => body });

test('browser location is rounded to about 1 km; missing location gives null', () => {
  assert.deepEqual(locationService.parseBrowserLocation('31.2518', '34.7913'), { latitude: 31.25, longitude: 34.79 });
  assert.equal(locationService.parseBrowserLocation(undefined, undefined), null);
});

test('reader location: town name from Nominatim in Hebrew, weather area rounded to ~10 km', async () => {
  const urls = [];
  const fetchFn = async (url, options) => {
    urls.push(url);
    assert.match(options.headers['User-Agent'], /TheDailyWeb/);
    return json({ address: { city: 'באר-שבע', country: 'ישראל' } });
  };
  const location = await locationService.describeReaderLocation({ latitude: 31.25, longitude: 34.79 }, fetchFn);
  assert.deepEqual(location, { latitude: 31.3, longitude: 34.8, cityName: 'באר-שבע, ישראל' });
  assert.match(urls[0], /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
  assert.match(urls[0], /accept-language=he/);
  // The same ~1 km cell is never looked up twice.
  await locationService.describeReaderLocation({ latitude: 31.25, longitude: 34.79 }, fetchFn);
  assert.equal(urls.length, 1);
});

test('reader location: a failed name lookup shows a generic name and is retried later', async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('offline'); };
  assert.equal(await locationService.getPlaceName({ latitude: 32.18, longitude: 34.87 }, failing), 'המיקום שלך');
  locationService.clearLocationCache(); // skip the 1-second Nominatim spacing in the test
  await locationService.getPlaceName({ latitude: 32.18, longitude: 34.87 }, failing);
  assert.equal(calls, 2);
});

test('invalid browser location is rejected with 400', () => {
  for (const [lat, lon] of [['91', '34'], ['32', '181'], ['abc', '34'], ['32', undefined], ['', ''], [['1'], '2']]) {
    assert.throws(() => locationService.parseBrowserLocation(lat, lon), { status: 400 });
  }
});
