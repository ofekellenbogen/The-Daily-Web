// Gives every browser a random, anonymous id stored in a cookie.
// Guests don't log in, so this id is how the server recognizes "the same device" for:
//   1. the comment limit (max 3 comments per minute per device)
//   2. the "seen / unseen" filter on the home page
const crypto = require('crypto');
const { readCookie } = require('../utils/cookies');

const COOKIE_NAME = 'dw_device';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deviceId(req, res, next) {
  let id = readCookie(req, COOKIE_NAME);

  // A missing or tampered cookie means this is a new device: create a fresh id.
  req.isNewDevice = !id || !UUID_PATTERN.test(id);
  if (req.isNewDevice) {
    id = crypto.randomUUID();
    res.cookie(COOKIE_NAME, id, {
      httpOnly: true, // JavaScript in the page can't read or change it
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ONE_YEAR_MS
    });
  }
  req.deviceId = id;
  next();
}

module.exports = deviceId;
