// A tiny logger: prints to the console AND appends to logs/app.log, so errors and
// important events (logins, publications, deletions...) are kept after the server stops.
// Each line looks like: 2026-10-24T14:00:00.000Z INFO [articles] approve 65f... by 65a...
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
// `node --test` sets NODE_TEST_CONTEXT; tests shouldn't fill the real log file.
const writeToFile = !process.env.NODE_TEST_CONTEXT;

if (writeToFile) fs.mkdirSync(LOG_DIR, { recursive: true });

function write(level, message, error) {
  const details = error ? ` | ${error.stack || error.message || error}` : '';
  const line = `${new Date().toISOString()} ${level} ${message}${details}\n`;
  // appendFile is asynchronous, so logging never slows down a request.
  if (writeToFile) fs.appendFile(LOG_FILE, line, () => {});
}

function info(message) {
  console.info(message);
  write('INFO', message);
}

function error(message, err) {
  console.error(message, err || '');
  write('ERROR', message, err);
}

module.exports = { info, error };
