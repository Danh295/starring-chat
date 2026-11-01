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

const { cardModel, nameColor, initialOf, NAME_COLORS } = require('../public/overlay-core');

test('nameColor is deterministic, case-insensitive and always from the palette', () => {
  assert.strictEqual(nameColor('PixelBean'), nameColor('pixelbean'));
  assert.ok(NAME_COLORS.includes(nameColor('anyone')));
  assert.ok(NAME_COLORS.length >= 10);
  const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(nameColor));
  assert.ok(colors.size >= 5, 'names spread across the palette');
  assert.ok(NAME_COLORS.includes(nameColor('')));
  assert.ok(NAME_COLORS.includes(nameColor(undefined)));
});

test('initialOf gives the first letter or digit, uppercased', () => {
  assert.strictEqual(initialOf('pixelbean'), 'P');
  assert.strictEqual(initialOf('_7up'), '7');
  assert.strictEqual(initialOf(''), '?');
  assert.strictEqual(initialOf(null), '?');
});

test('cardModel: kinds map to labels, verbs and classes', () => {
  const cast = cardModel({ kind: 'cast', user: 'Pixel', role: 'The Snack Critic', logline: 'Harsh but fair.', regular: false });
  assert.deepStrictEqual(cast, {
    className: 'cast', tier: 'cast', label: 'Starring', verb: 'joined the cast', who: 'Pixel', role: 'The Snack Critic',
    logline: 'Harsh but fair.', badge: '', color: nameColor('Pixel'), initial: 'P',
  });
  const guest = cardModel({ kind: 'guest', user: 'R', role: 'The Special Guest', logline: 'x' });
  assert.strictEqual(guest.label, 'Special guest star');
  assert.strictEqual(guest.verb, 'dropped in on a raid');
  assert.strictEqual(guest.className, 'guest');
  const lurk = cardModel({ kind: 'lurk', user: 'L', role: 'The Silent Observer', logline: 'x' });
  assert.strictEqual(lurk.label, 'Background extra');
  assert.strictEqual(lurk.verb, 'is watching from the back');
});

test('cardModel: Series Regulars get a badge and class', () => {
  const m = cardModel({ kind: 'cast', user: 'V', role: 'The Vet', logline: 'x', regular: true });
  assert.strictEqual(m.badge, 'Series regular');
  assert.strictEqual(m.className, 'cast regular');
});

test('cardModel: bad or missing fields are replaced, not shown as "undefined"', () => {
  const m = cardModel({ kind: 'weird', user: null, role: undefined, logline: 5 });
  assert.strictEqual(m.className, 'cast');
  assert.strictEqual(m.who, 'someone');
  assert.strictEqual(m.initial, 'S');
  assert.strictEqual(m.role, 'The Mystery Guest');
  assert.strictEqual(m.logline, '');
  assert.strictEqual(cardModel(null).role, 'The Mystery Guest');
});

test('cardModel: long text is clipped so a card never overflows', () => {
  const m = cardModel({ kind: 'cast', user: 'u'.repeat(80), role: 'The ' + 'x'.repeat(100), logline: 'y'.repeat(300) });
  assert.ok(m.who.length <= 25);
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

const { creditsModel } = require('../public/overlay-core');

test('creditsModel normalizes and clips an untrusted credits event', () => {
  const m = creditsModel({
    title: 'Episode 1: The One Where ' + 'x'.repeat(200),
    starring: [{ user: 'A', role: 'The A', regular: true }, { user: null, role: undefined }, 'junk'],
    guests: [{ user: 'G', role: 'The Special Guest' }], extras: 'nope',
    directedBy: 'chana', castingBy: 'Starring: Chat', compact: true, scrollMs: 5,
  });
  assert.ok(m.title.length <= 100);
  assert.strictEqual(m.starring.length, 2);
  assert.deepStrictEqual(m.starring[0], { user: 'A', role: 'The A', regular: true });
  assert.deepStrictEqual(m.starring[1], { user: 'someone', role: 'The Mystery Guest', regular: false });
  assert.deepStrictEqual(m.extras, []);
  assert.strictEqual(m.compact, true);
  assert.strictEqual(m.scrollMs, 20000);
  assert.strictEqual(creditsModel(null).starring.length, 0);
  assert.strictEqual(creditsModel({ scrollMs: 9e9 }).scrollMs, 90000);
});

test('creditsModel caps very long lists', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ user: 'u' + i, role: 'The X' }));
  assert.strictEqual(creditsModel({ starring: many }).starring.length, 200);
});

test('creditsModel: null, empty and non-numeric scrollMs fall back to the 45s default', () => {
  for (const v of [null, '', undefined, 'abc', NaN]) assert.strictEqual(creditsModel({ scrollMs: v }).scrollMs, 45000, String(v));
  assert.strictEqual(creditsModel({ scrollMs: 30000 }).scrollMs, 30000);
});

const { tierOf } = require('../public/overlay-core');

test('tierOf maps a cast member to a rarity tier: regular > cast; guest and lurk by kind', () => {
  assert.strictEqual(tierOf({ kind: 'cast', regular: true }), 'regular');
  assert.strictEqual(tierOf({ kind: 'cast' }), 'cast');
  assert.strictEqual(tierOf({ kind: 'guest' }), 'guest');
  assert.strictEqual(tierOf({ kind: 'lurk' }), 'lurk');
  assert.strictEqual(tierOf({ kind: 'guest', regular: true }), 'guest', 'only chatters become regulars');
  assert.strictEqual(tierOf({}), 'cast');
  assert.strictEqual(tierOf(null), 'cast');
});

test('cardModel carries the tier for colouring', () => {
  assert.strictEqual(cardModel({ kind: 'cast', regular: true, user: 'a', role: 'The A' }).tier, 'regular');
  assert.strictEqual(cardModel({ kind: 'lurk', user: 'a', role: 'The A' }).tier, 'lurk');
  assert.strictEqual(cardModel({ kind: 'nonsense' }).tier, 'cast');
});
