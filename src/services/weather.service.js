// Weather widget data from Open-Meteo (https://open-meteo.com): a free web service
// that needs no API key and no credit card.
//
// Scaling to thousands of readers: the server - not each browser - calls Open-Meteo,
// at most once every 14 minutes (the requirement allows data up to 15 minutes old).
// All readers get the cached copy. If Open-Meteo is down, the last cached data is shown.

// WMO weather codes (returned by Open-Meteo) -> Hebrew description and icon.
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

// Weather data must never be older than 15 minutes; 14 keeps us safely inside that window.
const CACHE_TTL_MS = 14 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

const DEFAULT_COORDS = {
  latitude: 32.1844,
  longitude: 34.8708,
  cityName: 'רעננה, ישראל'
};

// Hours ahead (relative to "now") shown in the "Today" list, and number of upcoming days.
const HOURLY_OFFSETS = [0, 3, 6, 9, 12];
const FORECAST_DAYS = 5;

// The cached response and when it was fetched (kept in server memory).
let cache = { data: null, fetchedAt: 0 };
// While a request to Open-Meteo is running, other callers wait for the same promise.
let inFlightPromise = null;

function getWeatherInfo(code, isDay = true) {
  const info = WMO_CODE_MAP[code] || DEFAULT_WEATHER_INFO;
  // Clear/mostly-clear skies at night get a moon instead of a sun.
  if (!isDay && (code === 0 || code === 1)) return { ...info, icon: '🌙' };
  return info;
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

function round(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function buildUrl(coords) {
  const params = new URLSearchParams({
    latitude: coords.latitude,
    longitude: coords.longitude,
    current_weather: 'true',
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: String(FORECAST_DAYS + 1),
    timezone: 'auto'
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function buildHourly(hourly, startIndex) {
  if (!Array.isArray(hourly?.time)) return [];
  return HOURLY_OFFSETS
    .map((offset, position) => {
      const index = startIndex + offset;
      const temperature = round(hourly.temperature_2m?.[index]);
      if (temperature === null) return null;
      const info = getWeatherInfo(hourly.weather_code?.[index], hourly.is_day?.[index] !== 0);
      return {
        time: position === 0 ? 'עכשיו' : hourly.time[index].slice(11, 16),
        temperature,
        icon: info.icon,
        description: info.description
      };
    })
    .filter(Boolean);
}

function buildDaily(daily) {
  if (!Array.isArray(daily?.time)) return [];
  // Index 0 is today (already shown above), so the forecast starts tomorrow.
  return daily.time.slice(1, FORECAST_DAYS + 1).map((date, i) => {
    const index = i + 1;
    const info = getWeatherInfo(daily.weather_code?.[index]);
    return {
      date,
      maxTemp: round(daily.temperature_2m_max?.[index]),
      minTemp: round(daily.temperature_2m_min?.[index]),
      icon: info.icon,
      description: info.description
    };
  });
}

// Calls Open-Meteo and converts its response into the shape the widget needs.
async function fetchFromOpenMeteo(coords, fetchFn = globalThis.fetch) {
  // Give up after 5 seconds so a slow provider never blocks our server.
  const response = await fetchFn(buildUrl(coords), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Open-Meteo returned status ${response.status}`);
  }
  const json = await response.json();
  const current = json.current_weather;
  if (!current || typeof current.temperature !== 'number') {
    throw new Error('Invalid weather data structure from external provider');
  }

  const hourly = json.hourly;
  const foundIndex = Array.isArray(hourly?.time) && current.time
    ? hourly.time.findIndex((t) => t.startsWith(current.time.slice(0, 13)))
    : -1;
  const index = Math.max(foundIndex, 0);

  const { description, icon } = getWeatherInfo(current.weathercode, current.is_day !== 0);
  const temperature = Math.round(current.temperature);

  return {
    city: coords.cityName,
    temperature,
    feelsLike: round(hourly?.apparent_temperature?.[index], temperature),
    tempMax: round(json.daily?.temperature_2m_max?.[0], temperature),
    tempMin: round(json.daily?.temperature_2m_min?.[0], temperature),
    humidity: round(hourly?.relative_humidity_2m?.[index]),
    precipitation: round(hourly?.precipitation_probability?.[index]),
    windSpeed: round(current.windspeed, 0),
    windDirection: round(current.winddirection),
    weatherCode: current.weathercode,
    description,
    icon,
    isDay: current.is_day !== 0,
    hourly: buildHourly(hourly, index),
    daily: buildDaily(json.daily),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Returns weather data from cache or the external provider.
 * Concurrent callers share one request (stampede protection) and a stale
 * cache is served if the provider fails.
 */
async function getWeather({ forceRefresh = false, fetchFn = globalThis.fetch, coords = DEFAULT_COORDS } = {}) {
  if (!forceRefresh && isCacheValid()) {
    return { ...cache.data, cached: true, stale: false };
  }

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const freshData = await fetchFromOpenMeteo(coords, fetchFn);
      cache = { data: freshData, fetchedAt: Date.now() };
      return { ...freshData, cached: false, stale: false };
    } catch (err) {
      console.error('[weather] Failed to fetch external weather data:', err.message);
      if (cache.data) {
        return { ...cache.data, cached: true, stale: true };
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
