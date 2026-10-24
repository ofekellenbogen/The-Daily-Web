// An error that already knows which HTTP status and message to send to the client.
// Services throw it (e.g. `throw new HttpError(404, 'NOT_FOUND', '...')`) and the
// central error handler (middleware/errorHandler.js) turns it into a response.
class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code (400, 401, 403, 404, 409, 429...)
   * @param {string} code    Short machine-readable code, e.g. 'NOT_FOUND'
   * @param {string} message Hebrew message that is safe to show to the user
   * @param {object} [fields] Optional per-field validation messages for forms
   */
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

module.exports = HttpError;
