const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(testContext) {
  const consoleLines = [];
  const fileLines = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/utils/logger.js'), 'utf8'), {
    module, __dirname,
    process: { env: { NODE_TEST_CONTEXT: testContext } },
    require(name) {
      return name === 'path' ? path : {
        mkdirSync() {},
        appendFile(file, line, callback) { fileLines.push(line); callback(); }
      };
    },
    console: Object.fromEntries(['info', 'warn', 'error'].map((level) => [level,
      (line) => consoleLines.push({ level, line })]))
  });
  return { logger: module.exports, consoleLines, fileLines };
}

test('console and file share timestamp, severity and descriptive context', () => {
  const { logger, consoleLines, fileLines } = setup();
  logger.info('[articles] Article submitted for editor review', { articleId: '123', status: 'pending', omitted: undefined });
  assert.match(consoleLines[0].line, /^\d{4}-\d{2}-\d{2}T.*Z INFO \[articles\] Article submitted for editor review/);
  assert.match(consoleLines[0].line, /articleId="123" status="pending"$/);
  assert.equal(fileLines[0], `${consoleLines[0].line}\n`);
});

test('warnings and errors use matching severity and preserve error details on one line', () => {
  const { logger, consoleLines } = setup('child');
  logger.warn('[auth] Login rejected', { reason: 'INVALID_CREDENTIALS' });
  logger.error('[http] Request failed', new Error('Database unavailable'), { status: 500 });
  assert.equal(consoleLines[0].level, 'warn');
  assert.match(consoleLines[0].line, / WARN /);
  assert.equal(consoleLines[1].level, 'error');
  assert.match(consoleLines[1].line, / ERROR .*status="500" error="Error: Database unavailable/);
  assert.equal(consoleLines[1].line.includes('\n'), false);
});

test('embedded newlines cannot forge entries and tests do not write real log files', () => {
  const { logger, consoleLines, fileLines } = setup('child');
  logger.info('event\nforged', { reason: 'value\r\nforged' });
  assert.equal(consoleLines[0].line.includes('\n'), false);
  assert.equal(consoleLines[0].line.includes('\r'), false);
  assert.equal(fileLines.length, 0);
});
