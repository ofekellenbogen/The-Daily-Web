// Finds the approximate location of the computer running the server, for the weather ticker.
//
// How: the public IP address of this computer is looked up with ipwho.is (free, no API key),
// which returns coordinates and a city name in English. Open-Meteo's geocoding API (the same
// free provider as the weather) then gives the city name in Hebrew.
//
// IP location is approximate: it is the area of the internet provider, usually the right city
// or a neighbouring one. It is detected once and kept for 24 hours, so all readers share one
// location and one cached forecast. If detection fails, DEFAULT_COORDS is used and the
// detection is retried after 10 minutes.
const logger = require('../utils/logger');
const { DEFAULT_COORDS } = require('./weather.service');

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

// The detection promise is cached, so simultaneous requests share one lookup.
let cached = { promise: null, expiresAt: 0 };

async function getJson(url, fetchFn) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} returned status ${response.status}`);
  return response.json();
}

// "Tel Aviv" -> "תל אביב-יפו, ישראל". Falls back to the English names if there is no Hebrew match.
async function hebrewPlaceName(city, country, countryCode, fetchFn) {
  try {
    const params = new URLSearchParams({ name: city, count: '1', language: 'he', countryCode });
    const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`, fetchFn);
    const place = data.results?.[0];
    if (place) return `${place.name}, ${place.country}`;
  } catch {
    // fall through to the English name
  }
  return `${city}, ${country}`;
}

async function detectLocation(fetchFn) {
  const ip = await getJson('https://ipwho.is/', fetchFn);
  if (!ip.success || typeof ip.latitude !== 'number' || typeof ip.longitude !== 'number') {
    throw new Error(ip.message || 'IP lookup failed');
  }
  return {
    latitude: ip.latitude,
    longitude: ip.longitude,
    cityName: await hebrewPlaceName(ip.city, ip.country, ip.country_code, fetchFn)
  };
}

// Returns { latitude, longitude, cityName } for this computer (never throws).
function getServerLocation(fetchFn = globalThis.fetch) {
  if (cached.promise && cached.expiresAt > Date.now()) return cached.promise;

  const promise = detectLocation(fetchFn)
    .then((location) => {
      logger.info(`[weather] server location detected: ${location.cityName}`);
      return location;
    })
    .catch((err) => {
      logger.error('[weather] could not detect the server location, using the default:', err.message);
      cached.expiresAt = Date.now() + FAILURE_TTL_MS;
      return DEFAULT_COORDS;
    });
  cached = { promise, expiresAt: Date.now() + SUCCESS_TTL_MS };
  return promise;
}

function clearLocationCache() {
  cached = { promise: null, expiresAt: 0 };
}

module.exports = { getServerLocation, clearLocationCache };
