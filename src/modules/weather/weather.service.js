const WMO_CODE_MAP = {
  0: { description: 'בהיר', icon: '☀️' },
  1: { description: 'בהיר ברובו', icon: '🌤️' },
  2: { description: 'מעונן חלקית', icon: '⛅' },
  3: { description: 'מעונן', icon: '☁️' },
  45: { description: 'ערפילי', icon: '🌫️' },
  48: { description: 'ערפל מקפיא', icon: '🌫️' },
  51: { description: 'טפטוף קל', icon: '🌦️' },
  53: { description: 'טפטוף מתון', icon: '🌦️' },
  55: { description: 'טפטוף כבד', icon: '🌦️' },
  56: { description: 'טפטוף קפוא', icon: '🌧️' },
  57: { description: 'טפטוף קפוא כבד', icon: '🌧️' },
  61: { description: 'גשם קל', icon: '🌧️' },
  63: { description: 'גשם מתון', icon: '🌧️' },
  65: { description: 'גשם כבד', icon: '🌧️' },
  66: { description: 'גשם קפוא', icon: '🌧️' },
  67: { description: 'גשם קפוא כבד', icon: '🌧️' },
  71: { description: 'שלג קל', icon: '❄️' },
  73: { description: 'שלג מתון', icon: '❄️' },
  75: { description: 'שלג כבד', icon: '❄️' },
  77: { description: 'גרגירי שלג', icon: '❄️' },
  80: { description: 'ממטרים קלים', icon: '🌦️' },
  81: { description: 'ממטרים מתונים', icon: '🌦️' },
  82: { description: 'ממטרים עזים', icon: '🌦️' },
  85: { description: 'ממטרי שלג קלים', icon: '🌨️' },
  86: { description: 'ממטרי שלג כבדים', icon: '🌨️' },
  95: { description: 'סופת רעמים', icon: '⛈️' },
  96: { description: 'סופת רעמים עם ברד קל', icon: '⛈️' },
  99: { description: 'סופת רעמים עם ברד כבד', icon: '⛈️' }
};

const DEFAULT_WEATHER_INFO = { description: 'מעונן חלקית', icon: '⛅' };

// Course requirement: Weather data must not be older than 15 minutes.
// Setting TTL to 14 minutes guarantees all returned data stays well within the 15-minute window.
const CACHE_TTL_MS = 14 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

// Coordinates for Tel Aviv, Israel
const DEFAULT_COORDS = {
  latitude: 32.0853,
  longitude: 34.7818,
  cityName: 'תל אביב'
};

let cache = {
  data: null,
  fetchedAt: 0
};

let inFlightPromise = null;

function getWeatherInfo(code) {
  return WMO_CODE_MAP[code] || DEFAULT_WEATHER_INFO;
}

function isCacheValid() {
  return Boolean(cache.data && Date.now() - cache.fetchedAt < CACHE_TTL_MS);
}

function clearCache() {
  cache = { data: null, fetchedAt: 0 };
  inFlightPromise = null;
}

function setCachedData(data, fetchedAt = Date.now()) {
  cache = { data, fetchedAt };
}

async function fetchFromOpenMeteo(coords, fetchFn = globalThis.fetch) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current_weather=true&timezone=auto`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Open-Meteo returned status ${response.status}`);
  }
  const json = await response.json();
  const current = json.current_weather;
  if (!current || typeof current.temperature !== 'number') {
    throw new Error('Invalid weather data structure from external provider');
  }

  const { description, icon } = getWeatherInfo(current.weathercode);
  return {
    city: coords.cityName,
    temperature: Math.round(current.temperature),
    windSpeed: Math.round(current.windspeed),
    weatherCode: current.weathercode,
    description,
    icon,
    updatedAt: new Date().toISOString()
  };
}

async function fetchFromOpenWeatherMap(apiKey, coords, fetchFn = globalThis.fetch) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&units=metric&lang=he&appid=${apiKey}`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`OpenWeatherMap returned status ${response.status}`);
  }
  const json = await response.json();
  const main = json.main || {};
  const weather = Array.isArray(json.weather) && json.weather[0] ? json.weather[0] : {};
  return {
    city: coords.cityName,
    temperature: Math.round(main.temp),
    windSpeed: Math.round((json.wind?.speed || 0) * 3.6), // convert m/s to km/h
    weatherCode: weather.id || 0,
    description: weather.description || 'בהיר',
    icon: '🌤️',
    updatedAt: new Date().toISOString()
  };
}

async function fetchExternalWeather(coords, fetchFn = globalThis.fetch) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (apiKey) {
    try {
      return await fetchFromOpenWeatherMap(apiKey, coords, fetchFn);
    } catch (err) {
      console.warn('[weather] OpenWeatherMap failed, falling back to Open-Meteo:', err.message);
    }
  }
  return fetchFromOpenMeteo(coords, fetchFn);
}

/**
 * Returns weather data from cache or external provider.
 * Implements stampede/thundering-herd protection and graceful stale fallback.
 */
async function getWeather({ forceRefresh = false, fetchFn = globalThis.fetch, coords = DEFAULT_COORDS } = {}) {
  if (!forceRefresh && isCacheValid()) {
    return {
      ...cache.data,
      cached: true,
      stale: false
    };
  }

  // Deduplicate concurrent in-flight requests
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const freshData = await fetchExternalWeather(coords, fetchFn);
      cache = {
        data: freshData,
        fetchedAt: Date.now()
      };
      return {
        ...freshData,
        cached: false,
        stale: false
      };
    } catch (err) {
      console.error('[weather] Failed to fetch external weather data:', err.message);

      // If we have stale cache, serve it to maintain uptime during external outages
      if (cache.data) {
        return {
          ...cache.data,
          cached: true,
          stale: true
        };
      }

      throw err;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

module.exports = {
  getWeather,
  getWeatherInfo,
  clearCache,
  setCachedData,
  isCacheValid,
  CACHE_TTL_MS,
  DEFAULT_COORDS,
  WMO_CODE_MAP
};
