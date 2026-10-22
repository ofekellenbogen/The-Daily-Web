const express = require('express');
const controller = require('./auth.controller');
const { sameOrigin } = require('../../middleware/auth');

const router = express.Router();
router.get('/login', controller.showLogin);
router.post('/login', sameOrigin, controller.login);
router.post('/logout', sameOrigin, controller.logout);

module.exports = router;
