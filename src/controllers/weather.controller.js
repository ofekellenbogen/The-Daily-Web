// Weather ticker API (used by public/js/weather.js at the top of the home page).
const weatherService = require('../services/weather.service');
const locationService = require('../services/location.service');
const logger = require('../utils/logger');

// GET /api/weather?lat=32.1&lon=34.8   (lat/lon optional)
async function getWeather(req, res) {
  // Invalid lat/lon -> 400 through the central error handler.
  const readerLocation = locationService.parseBrowserLocation(req.query.lat, req.query.lon);
  try {
    // The reader's location (with their town name) if the browser sent it,
    // otherwise the default location (Tel Aviv).
    const coords = readerLocation
      ? await locationService.describeReaderLocation(readerLocation)
      : weatherService.DEFAULT_COORDS;
    const weather = await weatherService.getWeather({ coords });
    // no-cache: the browser must ask the server on every reload, so its copy never adds extra delay.
    res.set('Cache-Control', 'no-cache');
    // The forecast is shared by a ~10 km area; the name is always this reader's own town.
    return res.json({ success: true, weather: { ...weather, city: coords.cityName } });
  } catch (err) {
    // The external service failed and there is no cached copy: the rest of the site keeps working.
    logger.error('[weather] Weather request failed', err);
    return res.status(503).json({
      success: false,
      message: 'שירות מזג האוויר אינו זמין כעת'
    });
  }
}

module.exports = { getWeather };
