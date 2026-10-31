const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTokenStore, createTwitchAuth, isLocalRequest, SCOPES } = require('../src/auth');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-auth-'));
const cfg = { twitchClientId: 'cid', twitchClientSecret: 'sec', port: 3000 };

function fakeFetch(handlers) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const h = handlers.shift();
    if (!h) throw new Error('unexpected fetch ' + url);
    const { status = 200, body = {} } = h(String(url), opts);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

test('token store round-trips and writes a private file', () => {
  const dir = tmp();
  const store = createTokenStore(dir);
  assert.strictEqual(store.load(), null);
  store.save({ access_token: 'a', refresh_token: 'r', expires_at: 5 });
  assert.deepStrictEqual(store.load(), { access_token: 'a', refresh_token: 'r', expires_at: 5 });
  const mode = fs.statSync(path.join(dir, 'tokens.json')).mode & 0o777;
  assert.strictEqual(mode, 0o600);
});

test('authorize URL has client id, redirect, scopes and state', () => {
  const auth = createTwitchAuth({ config: cfg, store: createTokenStore(tmp()), fetch: fakeFetch([]) });
  const { url, state } = auth.startLogin();
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'cid');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/callback');
  assert.strictEqual(u.searchParams.get('scope'), 'user:read:chat user:write:chat');
  assert.strictEqual(u.searchParams.get('state'), state);
  assert.deepStrictEqual(SCOPES, ['user:read:chat', 'user:write:chat']);
});

test('completeLogin rejects unknown state and exchanges a valid code', async () => {
  const store = createTokenStore(tmp());
  const fetch = fakeFetch([() => ({ body: { access_token: 'A', refresh_token: 'R', expires_in: 3600 } })]);
  const auth = createTwitchAuth({ config: cfg, store, fetch, now: () => 1000 });
  await assert.rejects(() => auth.completeLogin('code', 'bogus'), /state/);
  const { state } = auth.startLogin();
  await auth.completeLogin('code', state);
  assert.deepStrictEqual(store.load(), { access_token: 'A', refresh_token: 'R', expires_at: 1000 + 3600 * 1000 });
  const body = fetch.calls[0].opts.body;
  assert.match(body, /grant_type=authorization_code/);
  assert.match(body, /code=code/);
  // a state value is single-use
  await assert.rejects(() => auth.completeLogin('code', state), /state/);
});

test('getAccessToken refreshes when expired and keeps the new refresh token', async () => {
  const store = createTokenStore(tmp());
  store.save({ access_token: 'old', refresh_token: 'r1', expires_at: 1000 });
  const fetch = fakeFetch([() => ({ body: { access_token: 'new', refresh_token: 'r2', expires_in: 100 } })]);
  const auth = createTwitchAuth({ config: cfg, store, fetch, now: () => 2000 });
  assert.strictEqual(await auth.getAccessToken(), 'new');
  assert.strictEqual(store.load().refresh_token, 'r2');
  assert.match(fetch.calls[0].opts.body, /grant_type=refresh_token/);
});

test('getAccessToken returns stored token when still valid (with 60s margin)', async () => {
  const store = createTokenStore(tmp());
  store.save({ access_token: 'ok', refresh_token: 'r', expires_at: 1_000_000 });
  const auth = createTwitchAuth({ config: cfg, store, fetch: fakeFetch([]), now: () => 0 });
  assert.strictEqual(await auth.getAccessToken(), 'ok');
});

test('concurrent callers share one refresh', async () => {
  const store = createTokenStore(tmp());
  store.save({ access_token: 'old', refresh_token: 'r1', expires_at: 0 });
  const fetch = fakeFetch([() => ({ body: { access_token: 'n', refresh_token: 'r2', expires_in: 100 } })]);
  const auth = createTwitchAuth({ config: cfg, store, fetch, now: () => 10 });
  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.strictEqual(a, 'n'); assert.strictEqual(b, 'n');
  assert.strictEqual(fetch.calls.length, 1);
});

test('no tokens saved -> clear error', async () => {
  const auth = createTwitchAuth({ config: cfg, store: createTokenStore(tmp()), fetch: fakeFetch([]) });
  await assert.rejects(() => auth.getAccessToken(), /\/auth/);
});

test('helix request sends headers and retries once on 401 after refresh', async () => {
  const store = createTokenStore(tmp());
  store.save({ access_token: 'stale', refresh_token: 'r1', expires_at: 10_000_000 });
  const fetch = fakeFetch([
    () => ({ status: 401, body: {} }),
    () => ({ body: { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 } }),
    () => ({ body: { data: [1] } }),
  ]);
  const auth = createTwitchAuth({ config: cfg, store, fetch, now: () => 0 });
  const res = await auth.helix('/users?login=x');
  assert.deepStrictEqual(await res.json(), { data: [1] });
  assert.strictEqual(fetch.calls[0].url, 'https://api.twitch.tv/helix/users?login=x');
  assert.strictEqual(fetch.calls[0].opts.headers.Authorization, 'Bearer stale');
  assert.strictEqual(fetch.calls[0].opts.headers['Client-Id'], 'cid');
  assert.strictEqual(fetch.calls[2].opts.headers.Authorization, 'Bearer fresh');
});

test('helix does not loop forever on repeated 401', async () => {
  const store = createTokenStore(tmp());
  store.save({ access_token: 's', refresh_token: 'r', expires_at: 10_000_000 });
  const fetch = fakeFetch([
    () => ({ status: 401 }),
    () => ({ body: { access_token: 'f', refresh_token: 'r', expires_in: 3600 } }),
    () => ({ status: 401 }),
  ]);
  const auth = createTwitchAuth({ config: cfg, store, fetch, now: () => 0 });
  const res = await auth.helix('/users');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(fetch.calls.length, 3);
});

test('isLocalRequest: localhost host and no proxy headers only', () => {
  const req = (host, headers = {}) => ({ headers: { host, ...headers } });
  assert.strictEqual(isLocalRequest(req('localhost:3000')), true);
  assert.strictEqual(isLocalRequest(req('127.0.0.1:3000')), true);
  assert.strictEqual(isLocalRequest(req('[::1]:3000')), true);
  assert.strictEqual(isLocalRequest(req('abc.trycloudflare.com')), false);
  assert.strictEqual(isLocalRequest(req('localhost:3000', { 'cf-connecting-ip': '1.2.3.4' })), false);
  assert.strictEqual(isLocalRequest(req('localhost:3000', { 'x-forwarded-for': '1.2.3.4' })), false);
  assert.strictEqual(isLocalRequest(req('localhost:3000', { forwarded: 'for=1.2.3.4' })), false);
});

async function withApp(auth, fn) {
  const app = createApp({ config: loadConfig({}), auth });
  const server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}

test('GET /auth redirects to Twitch on localhost, 403 through a proxy', async () => {
  const auth = createTwitchAuth({ config: cfg, store: createTokenStore(tmp()), fetch: fakeFetch([]) });
  await withApp(auth, async (base) => {
    const ok = await fetch(`${base}/auth`, { redirect: 'manual' });
    assert.strictEqual(ok.status, 302);
    assert.match(ok.headers.get('location'), /^https:\/\/id\.twitch\.tv\/oauth2\/authorize/);
    const blocked = await fetch(`${base}/auth`, { redirect: 'manual', headers: { 'x-forwarded-for': '9.9.9.9' } });
    assert.strictEqual(blocked.status, 403);
    const cb = await fetch(`${base}/auth/callback?code=x&state=y`, { headers: { 'cf-connecting-ip': '9.9.9.9' } });
    assert.strictEqual(cb.status, 403);
  });
});

test('GET /auth/callback with bad state is a 400 and never echoes tokens', async () => {
  const store = createTokenStore(tmp());
  const auth = createTwitchAuth({ config: cfg, store, fetch: fakeFetch([]) });
  await withApp(auth, async (base) => {
    const res = await fetch(`${base}/auth/callback?code=x&state=nope`);
    assert.strictEqual(res.status, 400);
  });
});

test('GET /auth/callback with valid state saves tokens and shows a success page without secrets', async () => {
  const store = createTokenStore(tmp());
  const f = fakeFetch([() => ({ body: { access_token: 'SECRET-A', refresh_token: 'SECRET-R', expires_in: 3600 } })]);
  const auth = createTwitchAuth({ config: cfg, store, fetch: f });
  await withApp(auth, async (base) => {
    const { state } = auth.startLogin();
    const res = await fetch(`${base}/auth/callback?code=abc&state=${state}`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('SECRET'));
    assert.strictEqual(store.load().access_token, 'SECRET-A');
  });
});
