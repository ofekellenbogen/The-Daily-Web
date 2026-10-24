// Reads one cookie value from the request's "Cookie" header.
// Example header: "dw_session=abc123; dw_device=xyz" -> readCookie(req, 'dw_session') === 'abc123'
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    // Values may themselves contain "=", so the rest of the parts are joined back together.
    if (key === name) return value.join('=');
  }
  return null;
}

module.exports = { readCookie };
