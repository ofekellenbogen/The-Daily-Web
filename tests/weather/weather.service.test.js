const test = require('node:test');
const assert = require('node:assert/strict');
const weatherService = require('../../src/modules/weather/weather.service');

test.beforeEach(() => {
  weatherService.clearCache();
});

test('getWeatherInfo maps WMO codes to Hebrew descriptions and icons', () => {
  const clear = weatherService.getWeatherInfo(0);
  assert.equal(clear.description, 'בהיר');
  assert.equal(clear.icon, '☀️');

  const rain = weatherService.getWeatherInfo(61);
  assert.equal(rain.description, 'גשם קל');
  assert.equal(rain.icon, '🌧️');

  const thunder = weatherService.getWeatherInfo(95);
  assert.equal(thunder.description, 'סופת רעמים');
  assert.equal(thunder.icon, '⛈️');

  const unknown = weatherService.getWeatherInfo(9999);
  assert.equal(unknown.description, 'מעונן חלקית');
  assert.equal(unknown.icon, '⛅');
});

test('getWeather fetches from external provider and caches the result', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        current_weather: {
          temperature: 25.4,
          windspeed: 12.1,
          weathercode: 0,
          time: '2026-10-23T12:00'
        }
      })
    };
  };

  const result1 = await weatherService.getWeather({ fetchFn: mockFetch });
  assert.equal(fetchCount, 1);
  assert.equal(result1.city, 'תל אביב');
  assert.equal(result1.temperature, 25);
  assert.equal(result1.description, 'בהיר');
  assert.equal(result1.icon, '☀️');
  assert.equal(result1.cached, false);
  assert.equal(result1.stale, false);

  // Second call within TTL should return cached data without invoking mockFetch again
  const result2 = await weatherService.getWeather({ fetchFn: mockFetch });
  assert.equal(fetchCount, 1);
  assert.equal(result2.temperature, 25);
  assert.equal(result2.cached, true);
  assert.equal(result2.stale, false);
});

test('getWeather with forceRefresh=true bypasses cache', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        current_weather: {
          temperature: 20 + fetchCount,
          windspeed: 10,
          weathercode: 1,
          time: '2026-10-23T12:00'
        }
      })
    };
  };

  const r1 = await weatherService.getWeather({ fetchFn: mockFetch });
  assert.equal(fetchCount, 1);
  assert.equal(r1.temperature, 21);

  const r2 = await weatherService.getWeather({ forceRefresh: true, fetchFn: mockFetch });
  assert.equal(fetchCount, 2);
  assert.equal(r2.temperature, 22);
  assert.equal(r2.cached, false);
});

test('cache expires after CACHE_TTL_MS (under 15 minutes requirement)', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        current_weather: {
          temperature: 26,
          windspeed: 10,
          weathercode: 2,
          time: '2026-10-23T12:00'
        }
      })
    };
  };

  await weatherService.getWeather({ fetchFn: mockFetch });
  assert.equal(fetchCount, 1);
  assert.ok(weatherService.isCacheValid());

  // Manually age the cache by 15 minutes
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  weatherService.setCachedData({ city: 'תל אביב', temperature: 26 }, fifteenMinutesAgo);

  assert.equal(weatherService.isCacheValid(), false);

  // Next call should refetch
  await weatherService.getWeather({ fetchFn: mockFetch });
  assert.equal(fetchCount, 2);
});

test('concurrent requests deduplicate and share the same in-flight promise (stampede protection)', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    // Simulate slow network response
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      ok: true,
      json: async () => ({
        current_weather: {
          temperature: 28,
          windspeed: 15,
          weathercode: 0,
          time: '2026-10-23T12:00'
        }
      })
    };
  };

  // Launch 10 simultaneous requests
  const promises = Array.from({ length: 10 }, () => weatherService.getWeather({ fetchFn: mockFetch }));
  const results = await Promise.all(promises);

  assert.equal(fetchCount, 1);
  for (const res of results) {
    assert.equal(res.temperature, 28);
    assert.equal(res.description, 'בהיר');
  }
});

test('falls back to stale cache if external provider fails during refresh', async () => {
  weatherService.setCachedData({
    city: 'תל אביב',
    temperature: 24,
    description: 'בהיר',
    icon: '☀️',
    windSpeed: 10,
    weatherCode: 0,
    updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
  }, Date.now() - 20 * 60 * 1000); // 20 mins old

  const failingFetch = async () => {
    throw new Error('Network timeout');
  };

  const result = await weatherService.getWeather({ forceRefresh: true, fetchFn: failingFetch });
  assert.equal(result.temperature, 24);
  assert.equal(result.cached, true);
  assert.equal(result.stale, true);
});

test('throws if external provider fails and no cached data exists', async () => {
  const failingFetch = async () => {
    return {
      ok: false,
      status: 500
    };
  };

  await assert.rejects(
    async () => weatherService.getWeather({ fetchFn: failingFetch }),
    /Open-Meteo returned status 500/
  );
});
