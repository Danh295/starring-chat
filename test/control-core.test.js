const { test } = require('node:test');
const assert = require('node:assert');
const { createTwoStep, groupCast, countdownLabel } = require('../public/control-core');

test('two-step: the first press arms, a second press inside the window confirms', () => {
  let t = 0;
  const ts = createTwoStep({ now: () => t, windowMs: 4000 });
  assert.strictEqual(ts.press('new-episode'), 'armed');
  assert.strictEqual(ts.isArmed('new-episode'), true);
  t = 1000;
  assert.strictEqual(ts.press('new-episode'), 'confirmed');
  assert.strictEqual(ts.isArmed('new-episode'), false);
});

test('two-step: it disarms after the window, and pressing something else re-arms', () => {
  let t = 0;
  const ts = createTwoStep({ now: () => t, windowMs: 4000 });
  ts.press('a');
  t = 5000;
  assert.strictEqual(ts.isArmed('a'), false);
  assert.strictEqual(ts.press('a'), 'armed');
  assert.strictEqual(ts.press('b'), 'armed', 'a different key starts over');
  assert.strictEqual(ts.isArmed('a'), false);
  ts.reset();
  assert.strictEqual(ts.isArmed('b'), false);
});

test('groupCast groups by tier in a fixed order and skips empty groups', () => {
  const cast = [
    { login: 'a', kind: 'lurk' }, { login: 'b', kind: 'cast', regular: true }, { login: 'c', kind: 'cast' },
    { login: 'd', kind: 'guest' }, { login: 'e', kind: 'cast', regular: true },
  ];
  const groups = groupCast(cast);
  assert.deepStrictEqual(groups.map((g) => [g.tier, g.label, g.members.map((m) => m.login)]), [
    ['regular', 'Series regulars', ['b', 'e']],
    ['cast', 'Starring', ['c']],
    ['guest', 'Special guest stars', ['d']],
    ['lurk', 'Background extras', ['a']],
  ]);
  assert.deepStrictEqual(groupCast([]), []);
  assert.deepStrictEqual(groupCast(null), []);
});

test('countdownLabel rounds up to whole seconds and never goes negative', () => {
  assert.strictEqual(countdownLabel(44100), '45s');
  assert.strictEqual(countdownLabel(1), '1s');
  assert.strictEqual(countdownLabel(0), '0s');
  assert.strictEqual(countdownLabel(-500), '0s');
});

const { tierLabel, withParam, flattenCast } = require('../public/control-core');

test('tierLabel gives the singular name shown in the Type column', () => {
  assert.strictEqual(tierLabel('regular'), 'Series regular');
  assert.strictEqual(tierLabel('cast'), 'Starring');
  assert.strictEqual(tierLabel('guest'), 'Special guest star');
  assert.strictEqual(tierLabel('lurk'), 'Background extra');
  assert.strictEqual(tierLabel('nonsense'), 'Starring');
});

test('withParam keeps the rest of the query and removes empty values', () => {
  assert.strictEqual(withParam('?channel=demo', 'q', 'owl'), '?channel=demo&q=owl');
  assert.strictEqual(withParam('?channel=demo&q=owl', 'q', 'cat'), '?channel=demo&q=cat');
  assert.strictEqual(withParam('?channel=demo&q=owl', 'q', ''), '?channel=demo');
  assert.strictEqual(withParam('', 'q', 'a b'), '?q=a+b');
  assert.strictEqual(withParam('?q=x', 'q', ''), '');
});

test('flattenCast orders rows by tier and tags each with its tier', () => {
  const rows = flattenCast([
    { login: 'a', kind: 'lurk' }, { login: 'b', kind: 'cast', regular: true }, { login: 'c', kind: 'cast' },
  ]);
  assert.deepStrictEqual(rows.map((r) => [r.login, r.tier]), [['b', 'regular'], ['c', 'cast'], ['a', 'lurk']]);
  assert.deepStrictEqual(flattenCast(null), []);
});
