const crypto = require('crypto');

const COOKIE_NAME = 'dw_device';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// Gives every browser a random id, used for the "seen / unseen" filter and comment limits.
function deviceId(req, res, next) {
  let id = readCookie(req, COOKIE_NAME);
  req.isNewDevice = !id || !UUID_PATTERN.test(id);
  if (req.isNewDevice) {
    id = crypto.randomUUID();
    res.cookie(COOKIE_NAME, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ONE_YEAR_MS
    });
  }
  req.deviceId = id;
  next();
}

module.exports = deviceId;
