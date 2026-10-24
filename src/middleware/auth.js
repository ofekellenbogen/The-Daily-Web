// Authentication and permission middleware.
// All permission checks happen here on the server. Hiding buttons in the browser is
// only for convenience; a request that skips the UI is still blocked by these functions.
const authService = require('../services/auth.service');
const { readCookie } = require('../utils/cookies');
const HttpError = require('../utils/HttpError');

// Runs on every request: finds the logged-in user from the session cookie.
// The role always comes from the database, never from anything the browser sends.
async function loadUser(req, res, next) {
  const session = await authService.findSession(readCookie(req, authService.COOKIE_NAME));
  req.user = session?.userId || null; // populated User document, or null for a guest
  req.role = req.user?.role || 'guest';
  res.locals.currentUser = req.user; // makes `currentUser` available inside every EJS view
  next();
}

// Allows only logged-in users. Guests get 401 on the API or are redirected to the login page.
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    throw new HttpError(401, 'LOGIN_REQUIRED', 'יש להתחבר כדי לבצע פעולה זו');
  }
  res.redirect('/login');
}

// Allows only a specific role, e.g. requireRole('editor'). Use after requireAuth.
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      throw new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו');
    }
    next();
  };
}

// CSRF protection: browsers send an Origin header on cross-site form posts and fetch calls.
// If it doesn't match our own site, the request came from another website and is rejected.
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    throw new HttpError(403, 'FORBIDDEN', 'הבקשה אינה מורשית');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireRole, sameOrigin };
