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

const { cardModel } = require('../public/overlay-core');

test('cardModel: kinds map to labels and classes', () => {
  const cast = cardModel({ kind: 'cast', user: 'Pixel', role: 'The Snack Critic', logline: 'Harsh but fair.', regular: false });
  assert.deepStrictEqual(cast, { className: 'cast', label: 'STARRING', who: '@Pixel as', role: 'The Snack Critic', logline: 'Harsh but fair.', badge: '' });
  assert.strictEqual(cardModel({ kind: 'guest', user: 'R', role: 'The Special Guest', logline: 'x' }).label, 'SPECIAL GUEST STAR');
  assert.strictEqual(cardModel({ kind: 'guest', user: 'R', role: 'The Special Guest', logline: 'x' }).className, 'guest');
  assert.strictEqual(cardModel({ kind: 'lurk', user: 'L', role: 'The Silent Observer', logline: 'x' }).label, 'BACKGROUND EXTRA');
});

test('cardModel: Series Regulars get a badge and class', () => {
  const m = cardModel({ kind: 'cast', user: 'V', role: 'The Vet', logline: 'x', regular: true });
  assert.strictEqual(m.badge, 'SERIES REGULAR');
  assert.strictEqual(m.className, 'cast regular');
});

test('cardModel: bad or missing fields are replaced, not shown as "undefined"', () => {
  const m = cardModel({ kind: 'weird', user: null, role: undefined, logline: 5 });
  assert.strictEqual(m.className, 'cast');
  assert.strictEqual(m.who, '@someone as');
  assert.strictEqual(m.role, 'The Mystery Guest');
  assert.strictEqual(m.logline, '');
  assert.strictEqual(cardModel(null).role, 'The Mystery Guest');
});

test('cardModel: long text is clipped so a card never overflows', () => {
  const m = cardModel({ kind: 'cast', user: 'u'.repeat(80), role: 'The ' + 'x'.repeat(100), logline: 'y'.repeat(300) });
  assert.ok(m.who.length <= 32);
  assert.ok(m.role.length <= 44);
  assert.ok(m.logline.length <= 110);
});

test('removeWhere drops waiting cards and skips the current one if it matches', async () => {
  const shown = []; const hidden = [];
  const q = createCardQueue({
    show: (c) => shown.push(c.id), hide: (c) => { hidden.push(c.id); },
    wait: (_c, skipped) => new Promise((r) => { skipped.then(r); }),
  });
  q.push({ id: 1, login: 'a' }); q.push({ id: 2, login: 'b' }); q.push({ id: 3, login: 'a' }); q.push({ id: 4, login: 'c' });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(shown, [1]);
  const removed = q.removeWhere((c) => c.login === 'a');
  assert.strictEqual(removed, 2, 'one waiting + the current');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(hidden, [1]);
  assert.deepStrictEqual(shown, [1, 2]);
  q.clear(); q.skip(); await q.idle();
});

test('skip() ends the current hold early', async () => {
  const hidden = [];
  const q = createCardQueue({ show: () => {}, hide: (c) => { hidden.push(c.id); }, wait: (_c, skipped) => skipped });
  q.push({ id: 1 });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(hidden, []);
  q.skip(); await q.idle();
  assert.deepStrictEqual(hidden, [1]);
});

test('removeWhere ignores a card that is already exiting', async () => {
  let finishHide; const hideGate = new Promise((r) => { finishHide = r; });
  const q = createCardQueue({ show: () => {}, hide: () => hideGate, wait: async () => {} });
  q.push({ id: 1, login: 'a' });
  await new Promise((r) => setImmediate(r)); // now in the hide phase
  assert.strictEqual(q.removeWhere((c) => c.login === 'a'), 0);
  finishHide(); await q.idle();
});

test('reset() clears waiting cards and ends the current one', async () => {
  const shown = []; const hidden = [];
  const q = createCardQueue({ show: (c) => shown.push(c.id), hide: (c) => { hidden.push(c.id); }, wait: (_c, skipped) => skipped });
  q.push({ id: 1 }); q.push({ id: 2 }); q.push({ id: 3 });
  await new Promise((r) => setImmediate(r));
  q.reset(); await q.idle();
  assert.deepStrictEqual(shown, [1]);
  assert.deepStrictEqual(hidden, [1]);
});
