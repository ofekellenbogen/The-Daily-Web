const auth = require('../modules/auth/auth.service');
const { readCookie } = require('../utils/cookies');
const { HttpError } = require('./errors');

async function loadUser(req, res, next) {
  const session = await auth.findSession(readCookie(req, auth.COOKIE_NAME));
  req.user = session?.userId || null;
  req.role = req.user?.role || 'guest';
  res.locals.currentUser = req.user;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    throw new HttpError(401, 'LOGIN_REQUIRED', 'יש להתחבר כדי לבצע פעולה זו');
  }
  res.redirect('/login');
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      throw new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו');
    }
    next();
  };
}

// Browsers send Origin on cross-site form submissions and fetch requests.
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    throw new HttpError(403, 'FORBIDDEN', 'הבקשה אינה מורשית');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireRole, sameOrigin };
