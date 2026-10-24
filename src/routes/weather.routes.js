// Weather widget route (public).
const express = require('express');
const controller = require('../controllers/weather.controller');

const router = express.Router();

router.get('/api/weather', controller.getWeather);

module.exports = router;
