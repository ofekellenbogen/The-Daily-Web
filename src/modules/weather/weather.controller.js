const weatherService = require('./weather.service');

async function getWeather(req, res) {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const weather = await weatherService.getWeather({ forceRefresh });
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, weather });
  } catch (err) {
    console.error('[weather] Error in getWeather controller:', err.message);
    return res.status(503).json({
      success: false,
      message: 'שירות מזג האוויר אינו זמין כעת'
    });
  }
}

module.exports = { getWeather };
