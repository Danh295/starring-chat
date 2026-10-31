'use strict';
// Tiny timestamped logger. `write` and `now` are injectable for tests.
function createLogger({ write = (l) => console.log(l), now = () => new Date() } = {}) {
  const emit = (level) => (...args) =>
    write(`${now().toISOString()} ${level} ${args.map(String).join(' ')}`);
  return { info: emit('INFO'), warn: emit('WARN'), error: emit('ERROR') };
}
module.exports = { createLogger };
