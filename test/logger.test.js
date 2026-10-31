const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../src/logger');

test('log lines are ISO-timestamped with level', () => {
  const lines = [];
  const log = createLogger({ write: (l) => lines.push(l), now: () => new Date('2026-11-01T12:00:00Z') });
  log.info('hello', 'world');
  log.warn('careful');
  assert.strictEqual(lines[0], '2026-11-01T12:00:00.000Z INFO hello world');
  assert.strictEqual(lines[1], '2026-11-01T12:00:00.000Z WARN careful');
});
