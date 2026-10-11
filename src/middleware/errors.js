class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function notFound(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'הדף המבוקש לא נמצא'));
}

// Express recognizes error handlers by their 4 parameters, so `next` must stay.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  const message = status >= 500 ? 'אירעה שגיאה בשרת, נסו שוב מאוחר יותר' : err.message;
  if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      error: { code: err.code || 'INTERNAL_ERROR', message, fields: err.fields }
    });
  }
  res.status(status).render('error', { title: `שגיאה ${status}`, status, message });
}

module.exports = { HttpError, notFound, errorHandler };
