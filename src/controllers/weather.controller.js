// Weather ticker API (used by public/js/weather.js at the top of the home page).
const weatherService = require('../services/weather.service');
const locationService = require('../services/location.service');
const logger = require('../utils/logger');

// GET /api/weather?refresh=true
async function getWeather(req, res) {
  try {
    const forceRefresh = req.query.refresh === 'true';
    // Weather for the computer running the server (detected once a day, never throws).
    const coords = await locationService.getServerLocation();
    const weather = await weatherService.getWeather({ forceRefresh, coords });
    res.set('Cache-Control', 'public, max-age=60'); // browsers may reuse the answer for a minute
    return res.json({ success: true, weather });
  } catch (err) {
    // The external service failed and there is no cached copy: the rest of the site keeps working.
    logger.error('[weather] Error in getWeather controller:', err.message);
    return res.status(503).json({
      success: false,
      message: 'שירות מזג האוויר אינו זמין כעת'
    });
  }
}

module.exports = { getWeather };
