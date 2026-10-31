const { test } = require('node:test');
const assert = require('node:assert');
const { createCategoryLookup } = require('../src/category');

const authReturning = (game, calls = []) => ({
  calls,
  helix: async (p) => { calls.push(p); return { ok: true, json: async () => ({ data: [{ game_name: game }] }) }; },
});

test('returns the channel category and caches it', async () => {
  let t = 0;
  const auth = authReturning('Minecraft');
  const get = createCategoryLookup({ auth, now: () => t, ttlMs: 1000 });
  assert.strictEqual(await get('10'), 'Minecraft');
  assert.strictEqual(await get('10'), 'Minecraft');
  assert.strictEqual(auth.calls.length, 1);
  assert.strictEqual(auth.calls[0], '/channels?broadcaster_id=10');
  t = 2000;
  await get('10');
  assert.strictEqual(auth.calls.length, 2);
});

test('errors, missing auth and missing ids give an empty category', async () => {
  assert.strictEqual(await createCategoryLookup({ auth: { helix: async () => { throw new Error('x'); } } })('10'), '');
  assert.strictEqual(await createCategoryLookup({ auth: { helix: async () => ({ ok: false, status: 500 }) } })('10'), '');
  assert.strictEqual(await createCategoryLookup({ auth: null })('10'), '');
  assert.strictEqual(await createCategoryLookup({ auth: authReturning('x') })(undefined), '');
});

test('a slow Helix call is abandoned after the timeout', async () => {
  const auth = { helix: () => new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ data: [{ game_name: 'Late' }] }) }), 300)) };
  const get = createCategoryLookup({ auth, timeoutMs: 30 });
  assert.strictEqual(await get('10'), '');
});
