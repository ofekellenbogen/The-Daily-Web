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
  // Errors thrown by libraries (e.g. malformed JSON) may carry English internals, so only ours are shown as is.
  const isOwn = err instanceof HttpError && status < 500;
  let message = 'אירעה שגיאה בשרת, נסו שוב מאוחר יותר';
  let code = 'INTERNAL_ERROR';
  if (isOwn) {
    message = err.message;
    code = err.code;
  } else if (status < 500) {
    message = 'הבקשה אינה תקינה';
    code = 'BAD_REQUEST';
  }
  if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      error: { code, message, fields: isOwn ? err.fields : undefined }
    });
  }
  res.status(status).render('error', { title: `שגיאה ${status}`, status, message });
}

module.exports = { HttpError, notFound, errorHandler };
