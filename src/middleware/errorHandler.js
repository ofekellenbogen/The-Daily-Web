// The last two middlewares in app.js: a 404 handler and one central error handler.
// Every error thrown anywhere in a route ends up here, so the server never crashes
// because of bad input or forbidden actions. Express 5 forwards errors from async
// handlers automatically, so controllers don't need try/catch.
const HttpError = require('../utils/HttpError');
const logger = require('../utils/logger');

const DUPLICATE_KEY = 11000;

// Runs only when no route matched the request.
function notFound(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'הדף המבוקש לא נמצא'));
}

// Express recognizes an error handler by its 4 parameters, so `next` must stay even though it is unused.
function errorHandler(err, req, res, next) {
  // MongoDB unique-index violation (e.g. a username that already exists) -> 409 Conflict.
  if (err.code === DUPLICATE_KEY && !(err instanceof HttpError)) {
    err = new HttpError(409, 'DUPLICATE', 'הרשומה כבר קיימת');
  }
  const status = err.status || 500;

  // Unexpected (5xx) errors are logged with their stack trace for the developers.
  if (status >= 500) {
    logger.error('[http] Request failed with a server error', err, { method: req.method, path: req.path, status, code: err.code, userId: req.user?._id });
  }

  // Our own HttpError messages are written for users. Errors from libraries
  // (e.g. malformed JSON) may contain English internals, so they get a generic message.
  const isOwnError = err instanceof HttpError && status < 500;
  let message = 'אירעה שגיאה בשרת, נסו שוב מאוחר יותר';
  let code = 'INTERNAL_ERROR';
  if (isOwnError) {
    message = err.message;
    code = err.code;
  } else if (status < 500) {
    message = 'הבקשה אינה תקינה';
    code = 'BAD_REQUEST';
  }

  // Tells the browser how long to wait (used by the comment rate limit).
  if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));

  // API requests (Ajax) get JSON; normal page requests get a rendered error page.
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      error: { code, message, fields: isOwnError ? err.fields : undefined }
    });
  }
  res.status(status).render('error', { title: `שגיאה ${status}`, status, message });
}

module.exports = { notFound, errorHandler };
