// Login page, login form submit and logout.
const authService = require('../services/auth.service');
const { readCookie } = require('../utils/cookies');
const HttpError = require('../utils/HttpError');
const logger = require('../utils/logger');

// GET /login
function showLogin(req, res) {
  // Already logged in? Go straight to the workspace.
  if (req.user) return res.redirect(authService.workspacePath(req.user));
  res.render('auth/login', { title: 'התחברות', error: '', username: '' });
}

// POST /login
async function login(req, res) {
  try {
    const user = await authService.authenticate(req.body);
    const token = await authService.createSession(user._id);
    // Remove the old session (if any) so a previous login on this browser can't be reused.
    await authService.deleteSession(readCookie(req, authService.COOKIE_NAME));
    res.cookie(authService.COOKIE_NAME, token, { ...authService.cookieOptions(), maxAge: authService.SESSION_AGE_MS });
    logger.info('[auth] Login succeeded; session created', { userId: user._id, role: user.role });
    // Reporter -> /reporter, editor -> /editor. 303 makes the browser follow with a GET.
    res.redirect(303, authService.workspacePath(user));
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    logger.warn('[auth] Login rejected', { reason: err.code, status: err.status });
    // Show the form again with the error and the username the user typed.
    res.status(err.status).render('auth/login', {
      title: 'התחברות',
      error: err.message,
      username: typeof req.body?.username === 'string' ? req.body.username.slice(0, 100) : ''
    });
  }
}

// POST /logout
async function logout(req, res) {
  await authService.deleteSession(readCookie(req, authService.COOKIE_NAME));
  res.clearCookie(authService.COOKIE_NAME, authService.cookieOptions());
  logger.info('[auth] Logout completed; session removed', { userId: req.user?._id });
  res.redirect(303, '/login');
}

module.exports = { showLogin, login, logout };
