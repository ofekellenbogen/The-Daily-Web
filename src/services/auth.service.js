// Login, logout and persistent sessions.
//
// How login works:
//   1. The username/password are checked against the stored scrypt hash.
//   2. A random 64-character token is created and sent to the browser in an HttpOnly cookie.
//   3. Only the SHA-256 hash of that token is saved in the Session collection.
//   4. On every request, middleware/auth.js hashes the cookie and looks the session up.
// Because sessions live in MongoDB, a server restart doesn't log anyone out.
const { randomBytes, createHash } = require('node:crypto');
const User = require('../models/User');
const Session = require('../models/Session');
const { verifyPassword } = require('../utils/password');
const HttpError = require('../utils/HttpError');

const COOKIE_NAME = 'dw_session';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Returns the user if the credentials are correct, otherwise throws 400/401.
async function authenticate(input = {}) {
  const { username, password } = input;
  if (typeof username !== 'string' || !username.trim() || username.length > 100 ||
      typeof password !== 'string' || !password || password.length > 256) {
    throw new HttpError(400, 'INVALID_LOGIN', 'יש להזין שם משתמש וסיסמה תקינים');
  }
  const user = await User.findOne({ username: username.trim().toLowerCase() }).select('+passwordHash');
  // Same message for "no such user" and "wrong password", so attackers can't discover usernames.
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'שם המשתמש או הסיסמה שגויים');
  }
  return user;
}

// Creates a session and returns the raw token (to be placed in the cookie).
async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_AGE_MS)
  });
  return token;
}

// Returns the session with its user (username, displayName, role), or null.
async function findSession(token) {
  if (!TOKEN_PATTERN.test(token || '')) return null;
  // Expiry is checked here too, because MongoDB's TTL cleanup runs only about once a minute.
  return Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
    .populate('userId', 'username displayName role');
}

async function deleteSession(token) {
  if (TOKEN_PATTERN.test(token || '')) {
    await Session.deleteOne({ tokenHash: hashToken(token) });
  }
}

function cookieOptions() {
  return {
    httpOnly: true, // page JavaScript can't read the cookie (protects against XSS theft)
    sameSite: 'lax', // not sent on cross-site POSTs (CSRF protection)
    secure: process.env.NODE_ENV === 'production', // HTTPS-only in production
    path: '/'
  };
}

// Where each role lands after logging in.
function workspacePath(user) {
  return user.role === 'editor' ? '/editor' : '/reporter';
}

module.exports = {
  COOKIE_NAME, SESSION_AGE_MS, authenticate, createSession, findSession, deleteSession,
  cookieOptions, workspacePath
};
