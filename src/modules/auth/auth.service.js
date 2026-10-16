const { randomBytes, createHash } = require('node:crypto');
const User = require('../../models/User');
const Session = require('../../models/Session');
const { verifyPassword } = require('../../utils/password');
const { HttpError } = require('../../middleware/errors');

const COOKIE_NAME = 'dw_session';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function authenticate(input = {}) {
  const { username, password } = input;
  if (typeof username !== 'string' || !username.trim() || username.length > 100 ||
      typeof password !== 'string' || !password || password.length > 256) {
    throw new HttpError(400, 'INVALID_LOGIN', 'יש להזין שם משתמש וסיסמה תקינים');
  }
  const user = await User.findOne({ username: username.trim().toLowerCase() }).select('+passwordHash');
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'שם המשתמש או הסיסמה שגויים');
  }
  return user;
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await Session.create({ tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + SESSION_AGE_MS) });
  return token;
}

async function findSession(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  // Check expiry here too: MongoDB's TTL cleanup does not run immediately.
  return Session.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } })
    .populate('userId', 'username displayName role');
}

async function deleteSession(token) {
  if (/^[a-f0-9]{64}$/.test(token || '')) {
    await Session.deleteOne({ tokenHash: tokenHash(token) });
  }
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
}

function workspacePath(user) {
  return user.role === 'editor' ? '/editor' : '/reporter';
}

module.exports = {
  COOKIE_NAME, SESSION_AGE_MS, authenticate, createSession, findSession, deleteSession,
  cookieOptions, workspacePath
};
