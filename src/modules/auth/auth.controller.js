const auth = require('./auth.service');
const { readCookie } = require('../../utils/cookies');
const { HttpError } = require('../../middleware/errors');

function showLogin(req, res) {
  if (req.user) return res.redirect(auth.workspacePath(req.user));
  res.render('auth/login', { title: 'התחברות', error: '', username: '' });
}

async function login(req, res) {
  try {
    const user = await auth.authenticate(req.body);
    const token = await auth.createSession(user._id);
    await auth.deleteSession(readCookie(req, auth.COOKIE_NAME));
    res.cookie(auth.COOKIE_NAME, token, { ...auth.cookieOptions(), maxAge: auth.SESSION_AGE_MS });
    res.redirect(303, auth.workspacePath(user));
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    res.status(err.status).render('auth/login', {
      title: 'התחברות', error: err.message,
      username: typeof req.body?.username === 'string' ? req.body.username.slice(0, 100) : ''
    });
  }
}

async function logout(req, res) {
  await auth.deleteSession(readCookie(req, auth.COOKIE_NAME));
  res.clearCookie(auth.COOKIE_NAME, auth.cookieOptions());
  res.redirect(303, '/login');
}

module.exports = { showLogin, login, logout };
