// Decides WHERE the weather ticker shows the weather for.
//
// 1. Reader's location (preferred): the browser asks the reader for permission and sends
//    ?lat=&lon= with the weather request (see public/js/weather.js and parseBrowserLocation).
// 2. Server location (fallback, before permission or if the reader refuses): the public IP
//    address of the computer running the server is looked up with ipwho.is (free, no API key),
//    and Open-Meteo's geocoding API (same free provider as the weather) gives the Hebrew city name.
//    IP location is only approximate (the internet provider's area, often Tel Aviv in Israel).
//    It is detected once and kept for 24 hours. If detection fails, DEFAULT_COORDS is used and
//    the detection is retried after 10 minutes.
const logger = require('../utils/logger');
const HttpError = require('../utils/HttpError');
const { DEFAULT_COORDS } = require('./weather.service');

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const BROWSER_LOCATION_NAME = 'המיקום שלך';

// Reads the reader's location sent by the browser (?lat=32.1&lon=34.8).
// Returns null when none was sent. Coordinates are rounded to 1 decimal (about 10 km):
//   - privacy: the exact position is never used or stored
//   - scaling: everyone in the same area shares one cached forecast
function parseBrowserLocation(lat, lon) {
  if (lat === undefined && lon === undefined) return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (typeof lat !== 'string' || typeof lon !== 'string' || lat.trim() === '' || lon.trim() === '' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError(400, 'INVALID_LOCATION', 'מיקום לא תקין');
  }
  return {
    latitude: Math.round(latitude * 10) / 10,
    longitude: Math.round(longitude * 10) / 10,
    cityName: BROWSER_LOCATION_NAME
  };
}

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

module.exports = { parseBrowserLocation, getServerLocation, clearLocationCache };
