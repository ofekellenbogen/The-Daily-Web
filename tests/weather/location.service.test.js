const test = require('node:test');
const assert = require('node:assert/strict');
const locationService = require('../../src/services/location.service');
const { DEFAULT_COORDS } = require('../../src/services/weather.service');

test.beforeEach(() => locationService.clearLocationCache());

const ipAnswer = { success: true, latitude: 32.08, longitude: 34.78, city: 'Tel Aviv', country: 'Israel', country_code: 'IL' };
const json = (body) => ({ ok: true, json: async () => body });

test('detects the server location from its IP and names the city in Hebrew', async () => {
  const urls = [];
  const location = await locationService.getServerLocation(async (url) => {
    urls.push(url);
    return url.startsWith('https://ipwho.is')
      ? json(ipAnswer)
      : json({ results: [{ name: 'תל אביב-יפו', country: 'ישראל' }] });
  });
  assert.deepEqual(location, { latitude: 32.08, longitude: 34.78, cityName: 'תל אביב-יפו, ישראל' });
  assert.match(urls[1], /language=he/);
  assert.match(urls[1], /countryCode=IL/);
});

test('falls back to the English name when there is no Hebrew match', async () => {
  const location = await locationService.getServerLocation(async (url) =>
    url.startsWith('https://ipwho.is') ? json(ipAnswer) : json({}));
  assert.equal(location.cityName, 'Tel Aviv, Israel');
});

test('uses the default location when the IP lookup fails', async () => {
  const location = await locationService.getServerLocation(async () => { throw new Error('offline'); });
  assert.deepEqual(location, DEFAULT_COORDS);
});

test('the location is detected once and shared by later and simultaneous calls', async () => {
  let lookups = 0;
  const fetchFn = async (url) => {
    if (url.startsWith('https://ipwho.is')) lookups++;
    return url.startsWith('https://ipwho.is') ? json(ipAnswer) : json({});
  };
  await Promise.all([locationService.getServerLocation(fetchFn), locationService.getServerLocation(fetchFn)]);
  await locationService.getServerLocation(fetchFn);
  assert.equal(lookups, 1);
});

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
