const express = require('express');
const controller = require('./weather.controller');

const router = express.Router();

router.get('/api/weather', controller.getWeather);

module.exports = router;
