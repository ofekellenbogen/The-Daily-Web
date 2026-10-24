// Weather widget API (used by public/js/weather.js in the home page sidebar).
const weatherService = require('../services/weather.service');
const logger = require('../utils/logger');

// GET /api/weather?refresh=true
async function getWeather(req, res) {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const weather = await weatherService.getWeather({ forceRefresh });
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
