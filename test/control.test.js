const { test } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createAuthLimiter } = require('../src/guard');

const quiet = { info() {}, warn() {}, error() {} };

function fakes() {
  const calls = [];
  const casting = {
    getCast: (c) => { calls.push(['getCast', c]); return [{ login: 'a', name: 'A', role: 'The A', kind: 'cast', regular: false }]; },
    getEpisode: () => 4, isPaused: () => false,
    setPaused: (c, p) => calls.push(['setPaused', c, p]),
    startNewEpisode: (c) => { calls.push(['newEpisode', c]); return 5; },
    uncast: (c, l) => { calls.push(['uncast', c, l]); return true; },
  };
  const credits = { roll: async (c) => { calls.push(['roll', c]); return { rolled: true }; } };
  const broadcasts = [];
  const hub = { broadcast: (c, e) => { broadcasts.push([c, e]); return 1; } };
  return { calls, casting, credits, hub, broadcasts };
}

async function boot(t, env = { CONTROL_PASSWORD: 'pw' }, extra = {}) {
  const f = fakes();
  const app = createApp({ config: loadConfig(env), log: quiet, hub: f.hub, casting: f.casting, credits: f.credits, authLimiter: extra.authLimiter });
  const server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, { password, body, headers } = {}) => fetch(base + path, {
    method,
    headers: { ...(password !== undefined ? { 'x-control-password': password } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, f };
}

const ROUTES = [
  ['GET', '/api/control/cast?channel=chana'],
  ['POST', '/api/control/test-card', { channel: 'chana' }],
  ['POST', '/api/control/credits', { channel: 'chana' }],
  ['POST', '/api/control/pause', { channel: 'chana' }],
  ['POST', '/api/control/resume', { channel: 'chana' }],
  ['POST', '/api/control/new-episode', { channel: 'chana' }],
  ['POST', '/api/control/uncast', { channel: 'chana', login: 'a' }],
];

test('every control route checks the password, on localhost too', async (t) => {
  const { call, f } = await boot(t, { CONTROL_PASSWORD: 'pw' }, { authLimiter: createAuthLimiter({ max: 1000 }) });
  for (const [m, p, body] of ROUTES) {
    assert.strictEqual((await call(m, p, { body })).status, 401, `${m} ${p} without password`);
    assert.strictEqual((await call(m, p, { body, password: 'wrong' })).status, 401, `${m} ${p} wrong password`);
  }
  assert.deepStrictEqual(f.calls, [], 'nothing ran');
});

test('with no CONTROL_PASSWORD configured the control API is disabled', async (t) => {
  const { call } = await boot(t, {});
  for (const [m, p, body] of ROUTES) assert.strictEqual((await call(m, p, { body, password: '' })).status, 503, p);
});

test('the password is only accepted in the header, never the query string', async (t) => {
  const { call } = await boot(t);
  assert.strictEqual((await call('GET', '/api/control/cast?channel=chana&password=pw')).status, 401);
});

test('cast list returns episode, paused state and members', async (t) => {
  const { call } = await boot(t);
  const res = await call('GET', '/api/control/cast?channel=chana', { password: 'pw' });
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.episode, 4); assert.strictEqual(j.paused, false);
  assert.strictEqual(j.cast[0].login, 'a');
});

test('actions reach the engine, the credits roller and the overlay', async (t) => {
  const { call, f } = await boot(t);
  assert.strictEqual((await call('POST', '/api/control/pause', { password: 'pw', body: { channel: 'chana' } })).status, 200);
  assert.strictEqual((await call('POST', '/api/control/resume', { password: 'pw', body: { channel: 'chana' } })).status, 200);
  const ne = await (await call('POST', '/api/control/new-episode', { password: 'pw', body: { channel: 'chana' } })).json();
  assert.strictEqual(ne.episode, 5);
  assert.strictEqual((await call('POST', '/api/control/uncast', { password: 'pw', body: { channel: 'chana', login: 'A' } })).status, 200);
  const cr = await (await call('POST', '/api/control/credits', { password: 'pw', body: { channel: 'chana' } })).json();
  assert.strictEqual(cr.rolled, true);
  const tc = await (await call('POST', '/api/control/test-card', { password: 'pw', body: { channel: 'chana' } })).json();
  assert.strictEqual(tc.delivered, 1);
  assert.deepStrictEqual(f.calls.filter((c) => c[0] !== 'getCast'), [
    ['setPaused', 'chana', true], ['setPaused', 'chana', false], ['newEpisode', 'chana'], ['uncast', 'chana', 'a'], ['roll', 'chana'],
  ]);
  assert.strictEqual(f.broadcasts[0][1].type, 'cast');
});

test('bad channel or login is a 400', async (t) => {
  const { call } = await boot(t);
  assert.strictEqual((await call('POST', '/api/control/pause', { password: 'pw', body: { channel: 'Bad Name!' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/control/uncast', { password: 'pw', body: { channel: 'chana', login: '../x' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/control/uncast', { password: 'pw', body: { channel: 'chana' } })).status, 400);
  assert.strictEqual((await call('GET', '/api/control/cast', { password: 'pw' })).status, 400);
});

test('repeated wrong passwords lock the client out, even for the right password', async (t) => {
  const { call } = await boot(t, { CONTROL_PASSWORD: 'pw' }, { authLimiter: createAuthLimiter({ max: 3, windowMs: 60_000 }) });
  for (let i = 0; i < 3; i++) assert.strictEqual((await call('GET', '/api/control/cast?channel=chana', { password: 'nope' })).status, 401);
  assert.strictEqual((await call('GET', '/api/control/cast?channel=chana', { password: 'pw' })).status, 429);
});

test('oversized bodies are rejected', async (t) => {
  const { call } = await boot(t);
  const res = await call('POST', '/api/control/pause', { password: 'pw', body: { channel: 'chana', junk: 'x'.repeat(20_000) } });
  assert.ok([400, 413].includes(res.status));
});

test('control actions are never allowed cross-site', async (t) => {
  const { call } = await boot(t);
  const res = await call('POST', '/api/control/pause', { password: 'pw', body: { channel: 'chana' }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.strictEqual(res.status, 403);
});

test('limiter: failures expire after the window and successes do not count', () => {
  let t = 0;
  const l = createAuthLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.strictEqual(l.blocked('ip'), false);
  l.fail('ip'); l.fail('ip');
  assert.strictEqual(l.blocked('ip'), true);
  t = 1500;
  assert.strictEqual(l.blocked('ip'), false);
  assert.strictEqual(l.blocked('other'), false);
});
