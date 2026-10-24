// Console and file logs share a timestamp, severity, event description and context.
// Context must contain operational metadata only: never passwords, cookies or bodies.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const writeToFile = !process.env.NODE_TEST_CONTEXT;
if (writeToFile) fs.mkdirSync(LOG_DIR, { recursive: true });

// JSON escaping keeps user-controlled newlines from creating fake log entries.
function singleLine(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

function write(level, message, context = {}, err) {
  const fields = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${singleLine(key)}=${JSON.stringify(String(value))}`);
  if (err) fields.push(`error=${JSON.stringify(err.stack || err.message || String(err))}`);
  const line = `${new Date().toISOString()} ${level} ${singleLine(message)}${fields.length ? ` | ${fields.join(' ')}` : ''}`;
  const output = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info';
  console[output](line);
  if (writeToFile) fs.appendFile(LOG_FILE, `${line}\n`, () => {});
}

function info(message, context) { write('INFO', message, context); }
function warn(message, context) { write('WARN', message, context); }
function error(message, err, context) { write('ERROR', message, context, err); }

module.exports = { info, warn, error };
