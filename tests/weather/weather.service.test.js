const test = require('node:test');
const assert = require('node:assert/strict');
const weatherService = require('../../src/services/weather.service');

test.beforeEach(() => weatherService.clearCache());

function hours(count, start = '2026-10-24T00:00') {
  const base = new Date(`${start}:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(base + i * 3600000).toISOString().slice(0, 16));
}

function forecastResponse(overrides = {}) {
  const time = hours(48);
  return {
    ok: true,
    json: async () => ({
      current_weather: { temperature: 25.6, windspeed: 12.4, winddirection: 40, weathercode: 0, is_day: 1, time: '2026-10-24T10:15' },
      hourly: {
        time,
        temperature_2m: time.map((_, i) => 20 + i % 10),
        apparent_temperature: time.map(() => 27.2),
        relative_humidity_2m: time.map(() => 54),
        precipitation_probability: time.map(() => 10),
        weather_code: time.map(() => 1),
        is_day: time.map((t) => (Number(t.slice(11, 13)) >= 6 && Number(t.slice(11, 13)) < 18 ? 1 : 0))
      },
      daily: {
        time: ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'],
        weather_code: [0, 1, 2, 3, 61, 0],
        temperature_2m_max: [27.4, 28.1, 26, 24, 23, 26],
        temperature_2m_min: [17.6, 18, 17, 16, 15, 18]
      },
      ...overrides
    })
  };
}

test('getWeatherInfo maps WMO codes to Hebrew descriptions and icons', () => {
  assert.equal(weatherService.getWeatherInfo(0).description, 'בהיר');
  assert.equal(weatherService.getWeatherInfo(61).icon, '🌧️');
  assert.equal(weatherService.getWeatherInfo(9999).description, 'מעונן חלקית');
  assert.equal(weatherService.getWeatherInfo(0, false).icon, '🌙');
});

test('getWeather returns current conditions, today hourly list and daily forecast', async () => {
  const result = await weatherService.getWeather({ fetchFn: async () => forecastResponse() });
  assert.equal(result.city, 'רעננה, ישראל');
  assert.equal(result.temperature, 26);
  assert.equal(result.feelsLike, 27);
  assert.equal(result.tempMax, 27);
  assert.equal(result.tempMin, 18);
  assert.equal(result.humidity, 54);
  assert.equal(result.precipitation, 10);
  assert.equal(result.windSpeed, 12);

  assert.equal(result.hourly.length, 5);
  assert.equal(result.hourly[0].time, 'עכשיו');
  assert.equal(result.hourly[1].time, '13:00');
  assert.equal(result.hourly[4].time, '22:00');
  assert.equal(result.hourly[4].icon, '🌙');

  assert.equal(result.daily.length, 5);
  assert.equal(result.daily[0].date, '2026-10-25');
  assert.equal(result.daily[3].icon, '🌧️');
});

test('getWeather still works when the provider returns only current weather', async () => {
  const result = await weatherService.getWeather({
    fetchFn: async () => ({ ok: true, json: async () => ({ current_weather: { temperature: 20, windspeed: 5, weathercode: 3 } }) })
  });
  assert.equal(result.temperature, 20);
  assert.equal(result.feelsLike, 20);
  assert.deepEqual(result.hourly, []);
  assert.deepEqual(result.daily, []);
});

test('results are cached, and forceRefresh bypasses the cache', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return forecastResponse(); };
  const first = await weatherService.getWeather({ fetchFn });
  const second = await weatherService.getWeather({ fetchFn });
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  await weatherService.getWeather({ fetchFn, forceRefresh: true });
  assert.equal(calls, 2);
});

test('cache expires before 15 minutes', async () => {
  assert.ok(weatherService.CACHE_TTL_MS < 15 * 60 * 1000);
  weatherService.setCachedData({ temperature: 1 }, Date.now() - 15 * 60 * 1000);
  assert.equal(weatherService.isCacheValid(), false);
});

test('concurrent requests share one in-flight fetch', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return forecastResponse();
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => weatherService.getWeather({ fetchFn })));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.temperature === 26));
});

test('serves stale cache when the provider fails, and throws when there is none', async () => {
  const failing = async () => { throw new Error('Network timeout'); };
  await assert.rejects(weatherService.getWeather({ fetchFn: failing }), /Network timeout/);

  weatherService.setCachedData({ temperature: 24 }, Date.now() - 20 * 60 * 1000);
  const result = await weatherService.getWeather({ fetchFn: failing });
  assert.equal(result.temperature, 24);
  assert.equal(result.stale, true);

  weatherService.clearCache();
  await assert.rejects(
    weatherService.getWeather({ fetchFn: async () => ({ ok: false, status: 500 }) }),
    /Open-Meteo returned status 500/
  );
});

test('each area has its own cache entry', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return forecastResponse(); };
  const beerSheva = { latitude: 31.3, longitude: 34.8, cityName: 'המיקום שלך' };
  await weatherService.getWeather({ fetchFn });
  await weatherService.getWeather({ fetchFn, coords: beerSheva });
  await weatherService.getWeather({ fetchFn, coords: beerSheva });
  await weatherService.getWeather({ fetchFn });
  assert.equal(calls, 2);
  assert.equal(weatherService.isCacheValid(beerSheva), true);
});
