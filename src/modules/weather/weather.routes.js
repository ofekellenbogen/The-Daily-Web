const express = require('express');
const weatherController = require('./weather.controller');

const router = express.Router();

router.get('/api/weather', weatherController.getWeather);

module.exports = router;
