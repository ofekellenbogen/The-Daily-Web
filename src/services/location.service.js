// Decides WHERE the weather ticker shows the weather for, and what to call that place.
//
// - Reader's location found: the browser asks the reader for permission and sends ?lat=&lon=
//   rounded to 2 decimals (~1 km) with the weather request (see public/js/weather.js).
//   The town name ("באר-שבע, ישראל") comes from OpenStreetMap's free Nominatim reverse-geocoding
//   service. Names don't change, so each ~1 km cell is looked up only once and remembered.
//   Nominatim allows at most 1 request per second, so lookups are spaced 1 second apart.
// - Location not found (permission refused, not supported, no ?lat=&lon=): the controller uses
//   DEFAULT_COORDS from weather.service.js - Tel Aviv, labelled "מיקום ברירת מחדל".
const logger = require('../utils/logger');
const HttpError = require('../utils/HttpError');

const TIMEOUT_MS = 5000;
const UNKNOWN_PLACE_NAME = 'המיקום שלך'; // location found, but the town name lookup failed
const NOMINATIM_GAP_MS = 1000;
const MAX_CACHED_NAMES = 5000;
// Nominatim's rules require an identifying User-Agent.
const NOMINATIM_HEADERS = { 'User-Agent': 'TheDailyWeb student project (github.com/ofekellenbogen/The-Daily-Web)' };

const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// ===== Reader's location ===========================================================

// Reads ?lat=&lon= sent by the browser. Returns null when none was sent, otherwise the
// coordinates rounded to 2 decimals (~1 km - enough to name the town, never the exact position).
function parseBrowserLocation(lat, lon) {
  if (lat === undefined && lon === undefined) return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (typeof lat !== 'string' || typeof lon !== 'string' || lat.trim() === '' || lon.trim() === '' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError(400, 'INVALID_LOCATION', 'מיקום לא תקין');
  }
  return { latitude: roundTo(latitude, 2), longitude: roundTo(longitude, 2) };
}

// Town names already found: "lat,lon" -> promise of the name. Simultaneous requests share one lookup.
const placeNames = new Map();
let nextNominatimSlot = 0;

// Waits until at least 1 second has passed since the previous Nominatim request.
async function waitForNominatimSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextNominatimSlot - now);
  nextNominatimSlot = Math.max(now, nextNominatimSlot) + NOMINATIM_GAP_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function lookUpPlaceName({ latitude, longitude }, fetchFn) {
  await waitForNominatimSlot();
  const params = new URLSearchParams({
    format: 'jsonv2', lat: latitude, lon: longitude, zoom: '10', 'accept-language': 'he'
  });
  const response = await fetchFn(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: NOMINATIM_HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Nominatim returned status ${response.status}`);
  const data = await response.json();
  const address = data.address || {};
  const town = address.city || address.town || address.village || address.municipality ||
    address.county || address.state || data.name;
  if (!town) throw new Error('Nominatim returned no place name');
  return address.country ? `${town}, ${address.country}` : town;
}

// "31.25,34.79" -> "באר-שבע, ישראל" (never throws; unknown places get UNKNOWN_PLACE_NAME).
function getPlaceName(location, fetchFn = globalThis.fetch) {
  const key = `${location.latitude},${location.longitude}`;
  if (placeNames.has(key)) return placeNames.get(key);

  if (placeNames.size >= MAX_CACHED_NAMES) placeNames.delete(placeNames.keys().next().value);
  const promise = lookUpPlaceName(location, fetchFn).catch((err) => {
    logger.error('[weather] could not name the reader location:', err.message);
    placeNames.delete(key); // try again next time
    return UNKNOWN_PLACE_NAME;
  });
  placeNames.set(key, promise);
  return promise;
}

// The coordinates used for the WEATHER are rounded further, to 1 decimal (~10 km), so all
// readers in the same area share one cached forecast. The name stays the reader's own town.
async function describeReaderLocation(location, fetchFn = globalThis.fetch) {
  return {
    latitude: roundTo(location.latitude, 1),
    longitude: roundTo(location.longitude, 1),
    cityName: await getPlaceName(location, fetchFn)
  };
}

function clearLocationCache() {
  placeNames.clear();
  nextNominatimSlot = 0;
}

module.exports = { parseBrowserLocation, describeReaderLocation, getPlaceName, clearLocationCache };
