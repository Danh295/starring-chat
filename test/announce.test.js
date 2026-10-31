const { test } = require('node:test');
const assert = require('node:assert');
const { createAnnouncer } = require('../src/announce');

const quiet = { info() {}, warn() {}, error() {} };

test('looks up the bot id once and posts to the chat messages endpoint', async () => {
  const calls = [];
  const auth = { helix: async (p, o) => {
    calls.push([p, o && o.body && JSON.parse(o.body)]);
    if (p.startsWith('/users')) return { ok: true, json: async () => ({ data: [{ id: '1' }] }) };
    return { ok: true, json: async () => ({}) };
  } };
  const a = createAnnouncer({ auth, config: { botUsername: 'mybot' }, log: quiet });
  await a.send('10', 'Now starring @Bob as The Critic');
  await a.send('10', 'again');
  assert.strictEqual(calls.filter((c) => c[0].startsWith('/users')).length, 1);
  assert.deepStrictEqual(calls[1], ['/chat/messages', { broadcaster_id: '10', sender_id: '1', message: 'Now starring @Bob as The Critic' }]);
});

test('failures are swallowed with a warning', async () => {
  const warns = [];
  const auth = { helix: async () => { throw new Error('nope'); } };
  const a = createAnnouncer({ auth, config: { botUsername: 'mybot' }, log: { ...quiet, warn: (...x) => warns.push(x.join(' ')) } });
  await a.send('10', 'hi');
  assert.ok(warns.length >= 1);
});

test('messages are capped at 500 characters', async () => {
  let body;
  const auth = { helix: async (p, o) => {
    if (p.startsWith('/users')) return { ok: true, json: async () => ({ data: [{ id: '1' }] }) };
    body = JSON.parse(o.body); return { ok: true, json: async () => ({}) };
  } };
  await createAnnouncer({ auth, config: { botUsername: 'b' }, log: quiet }).send('10', 'x'.repeat(900));
  assert.strictEqual(body.message.length, 500);
});
