const { test } = require('node:test');
const assert = require('node:assert');
const { createCardQueue } = require('../public/overlay-core');

test('shows one card at a time, in order, then idles', async () => {
  const log = [];
  const q = createCardQueue({
    show: (c) => log.push('show ' + c.id),
    hide: (c) => log.push('hide ' + c.id),
    wait: async () => { log.push('wait'); },
  });
  q.push({ id: 1 }); q.push({ id: 2 }); q.push({ id: 3 });
  await q.idle();
  assert.deepStrictEqual(log, ['show 1', 'wait', 'hide 1', 'show 2', 'wait', 'hide 2', 'show 3', 'wait', 'hide 3']);
});

test('cards pushed while one is showing wait their turn', async () => {
  const log = []; let release;
  const q = createCardQueue({
    show: (c) => log.push('show ' + c.id), hide: (c) => log.push('hide ' + c.id),
    wait: () => new Promise((r) => { release = r; }),
  });
  q.push({ id: 1 }); q.push({ id: 2 });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(log, ['show 1']);
  release(); await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(log, ['show 1', 'hide 1', 'show 2']);
  release(); await q.idle();
});

test('a throwing show does not stall the queue', async () => {
  const log = [];
  const q = createCardQueue({
    show: (c) => { if (c.id === 1) throw new Error('x'); log.push('show ' + c.id); },
    hide: () => {}, wait: async () => {},
  });
  q.push({ id: 1 }); q.push({ id: 2 });
  await q.idle();
  assert.deepStrictEqual(log, ['show 2']);
});

test('queue is capped, dropping the oldest waiting card', async () => {
  const shown = []; let release;
  const q = createCardQueue({
    show: (c) => shown.push(c.id), hide: () => {}, wait: () => new Promise((r) => { release = r; }), max: 2,
  });
  q.push({ id: 1 }); q.push({ id: 2 }); q.push({ id: 3 }); q.push({ id: 4 });
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 3; i++) { release(); await new Promise((r) => setImmediate(r)); }
  assert.deepStrictEqual(shown, [1, 3, 4]);
});

test('clear() empties waiting cards', async () => {
  const shown = []; let release;
  const q = createCardQueue({ show: (c) => shown.push(c.id), hide: () => {}, wait: () => new Promise((r) => { release = r; }) });
  q.push({ id: 1 }); q.push({ id: 2 });
  q.clear();
  await new Promise((r) => setImmediate(r));
  release(); await q.idle();
  assert.deepStrictEqual(shown, [1]);
});
