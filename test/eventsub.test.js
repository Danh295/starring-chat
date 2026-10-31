const { test } = require('node:test');
const assert = require('node:assert');
const { WebSocketServer } = require('ws');
const { createEventSubClient } = require('../src/eventsub');

const quiet = { info() {}, warn() {}, error() {} };
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('timed out waiting for condition');
};

async function fakeTwitch() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  const sockets = [];
  wss.on('connection', (ws, req) => { ws.path = req.url; sockets.push(ws); });
  const url = (p = '/ws') => `ws://127.0.0.1:${wss.address().port}${p}`;
  const send = (ws, type, payload = {}, extra = {}) =>
    ws.send(JSON.stringify({ metadata: { message_id: extra.id || Math.random().toString(36), message_type: type, ...extra.meta }, payload }));
  const welcome = (ws, id = 'sess1', keepalive = 10) =>
    send(ws, 'session_welcome', { session: { id, keepalive_timeout_seconds: keepalive } });
  return { wss, sockets, url, send, welcome, close: () => { sockets.forEach((s) => s.terminate()); return new Promise((r) => wss.close(r)); } };
}

function fakeAuth({ failTypes = [], users } = {}) {
  const calls = [];
  const table = users || { mybot: '1', chana: '10', chanb: '11' };
  return {
    calls,
    async helix(path, opts = {}) {
      calls.push({ path, body: opts.body ? JSON.parse(opts.body) : null });
      if (path.startsWith('/users')) {
        const logins = new URLSearchParams(path.split('?')[1]).getAll('login');
        const data = logins.filter((l) => table[l]).map((l) => ({ id: table[l], login: l, display_name: l }));
        return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
      }
      if (path === '/eventsub/subscriptions') {
        const type = JSON.parse(opts.body).type;
        if (failTypes.includes(type)) return { ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' };
        return { ok: true, status: 202, json: async () => ({}), text: async () => '' };
      }
      throw new Error('unexpected ' + path);
    },
  };
}

function makeClient(t, extra = {}) {
  const events = { chat: [], raid: [] };
  const client = createEventSubClient({
    config: { botUsername: 'mybot', channels: ['chana', 'chanb'] },
    auth: extra.auth || fakeAuth(),
    log: quiet,
    onChat: (e) => { if (extra.onChat) extra.onChat(e); events.chat.push(e); },
    onRaid: (e) => events.raid.push(e),
    endpoint: extra.endpoint,
    msPerSecond: extra.msPerSecond ?? 1000,
    backoff: () => 10,
  });
  t.after(() => client.stop());
  return { client, events };
}

const chatPayload = (over = {}) => ({
  subscription: { type: 'channel.chat.message' },
  event: {
    broadcaster_user_id: '10', broadcaster_user_login: 'chana',
    chatter_user_id: '99', chatter_user_login: 'viewer', chatter_user_name: 'Viewer',
    message: { text: 'hello there' }, message_type: 'text', badges: [], ...over,
  },
});

test('looks up ids and subscribes to chat + notifications per channel after welcome', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const auth = fakeAuth();
  const { client } = makeClient(t, { auth, endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0], 'abc');
  await until(() => auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length === 4);
  const subs = auth.calls.filter((c) => c.path === '/eventsub/subscriptions').map((c) => c.body);
  assert.deepStrictEqual(subs.map((s) => [s.type, s.condition.broadcaster_user_id]).sort(),
    [['channel.chat.message', '10'], ['channel.chat.message', '11'], ['channel.chat.notification', '10'], ['channel.chat.notification', '11']]);
  for (const s of subs) {
    assert.strictEqual(s.version, '1');
    assert.strictEqual(s.condition.user_id, '1');
    assert.deepStrictEqual(s.transport, { method: 'websocket', session_id: 'abc' });
  }
});

test('chat messages become normalized events with broadcaster/mod flags', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client, events } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'm1' });
  tw.send(tw.sockets[0], 'notification', chatPayload({ chatter_user_id: '10', chatter_user_login: 'chana' }), { id: 'm2' });
  tw.send(tw.sockets[0], 'notification', chatPayload({ badges: [{ set_id: 'moderator', id: '1', info: '' }] }), { id: 'm3' });
  await until(() => events.chat.length === 3);
  assert.deepStrictEqual(events.chat[0], {
    channel: 'chana', broadcasterId: '10', chatterId: '99', chatterLogin: 'viewer', chatterName: 'Viewer',
    text: 'hello there', isBroadcaster: false, isMod: false, messageType: 'text',
  });
  assert.strictEqual(events.chat[1].isBroadcaster, true);
  assert.strictEqual(events.chat[2].isMod, true);
});

test('raid notifications become raid events', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client, events } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'notification', {
    subscription: { type: 'channel.chat.notification' },
    event: { broadcaster_user_id: '10', broadcaster_user_login: 'chana', notice_type: 'raid',
      raid: { user_id: '77', user_login: 'raider', user_name: 'Raider', viewer_count: 42 } },
  });
  tw.send(tw.sockets[0], 'notification', {
    subscription: { type: 'channel.chat.notification' },
    event: { broadcaster_user_id: '10', broadcaster_user_login: 'chana', notice_type: 'sub' },
  });
  await until(() => events.raid.length === 1);
  assert.deepStrictEqual(events.raid[0], { channel: 'chana', raiderId: '77', raiderLogin: 'raider', raiderName: 'Raider', viewers: 42 });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(events.raid.length, 1);
});

test('duplicate message ids are ignored', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client, events } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'same' });
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'same' });
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'other' });
  await until(() => events.chat.length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(events.chat.length, 2);
});

test('notification subscription failure only warns; chat keeps working', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const warns = [];
  const auth = fakeAuth({ failTypes: ['channel.chat.notification'] });
  const events = { chat: [] };
  const client = createEventSubClient({
    config: { botUsername: 'mybot', channels: ['chana'] }, auth,
    log: { ...quiet, warn: (...a) => warns.push(a.join(' ')) },
    onChat: (e) => events.chat.push(e), onRaid() {}, endpoint: tw.url(), backoff: () => 10,
  });
  t.after(() => client.stop());
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => warns.some((w) => /channel\.chat\.notification/.test(w)));
  tw.send(tw.sockets[0], 'notification', chatPayload());
  await until(() => events.chat.length === 1);
});

test('unknown channel is skipped with a warning', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const warns = [];
  const auth = fakeAuth({ users: { mybot: '1', chana: '10' } });
  const client = createEventSubClient({
    config: { botUsername: 'mybot', channels: ['chana', 'ghost'] }, auth,
    log: { ...quiet, warn: (...a) => warns.push(a.join(' ')) },
    onChat() {}, onRaid() {}, endpoint: tw.url(), backoff: () => 10,
  });
  t.after(() => client.stop());
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length === 2);
  assert.ok(warns.some((w) => /ghost/.test(w)));
});

test('session_reconnect moves to the new url without resubscribing, then closes the old socket', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const auth = fakeAuth();
  const { client } = makeClient(t, { auth, endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length === 4);
  const old = tw.sockets[0];
  tw.send(old, 'session_reconnect', { session: { reconnect_url: tw.url('/reconnect') } });
  await until(() => tw.sockets.length === 2);
  assert.strictEqual(tw.sockets[1].path, '/reconnect');
  assert.strictEqual(old.readyState, 1, 'old socket stays open until the new welcome');
  tw.welcome(tw.sockets[1], 'sess2');
  await until(() => old.readyState === 3);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length, 4);
});

test('dropped socket reconnects and resubscribes', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const auth = fakeAuth();
  const { client } = makeClient(t, { auth, endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length === 4);
  tw.sockets[0].terminate();
  await until(() => tw.sockets.length === 2);
  tw.welcome(tw.sockets[1], 'sess3');
  await until(() => auth.calls.filter((c) => c.path === '/eventsub/subscriptions').length === 8);
});

test('silence past the keepalive timeout forces a reconnect', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client } = makeClient(t, { endpoint: tw.url(), msPerSecond: 5 });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0], 's', 10); // 10s * 5ms = 50ms (+ grace)
  await until(() => tw.sockets.length === 2, 3000);
});

test('a throwing chat handler does not break the connection', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  let n = 0;
  const { client, events } = makeClient(t, { endpoint: tw.url(), onChat: () => { if (n++ === 0) throw new Error('boom'); } });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'a' });
  tw.send(tw.sockets[0], 'notification', chatPayload(), { id: 'b' });
  await until(() => events.chat.length === 1);
  assert.strictEqual(tw.sockets.length, 1);
});

test('stop() closes the socket and does not reconnect', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  client.stop();
  await until(() => tw.sockets[0].readyState === 3);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(tw.sockets.length, 1);
});

test('a failed reconnect url does not open a duplicate connection; the old socket closing triggers a normal reconnect', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'session_reconnect', { session: { reconnect_url: tw.url('/reconnect') } });
  await until(() => tw.sockets.length === 2);
  tw.sockets[1].terminate();           // migration socket dies before welcome
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(tw.sockets.length, 2, 'no extra connection while the old one is alive');
  tw.sockets[0].terminate();           // Twitch closes the old one (4004)
  await until(() => tw.sockets.length === 3);
});

test('start() keeps retrying the user lookup until it works', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const real = fakeAuth();
  let fails = 2;
  const auth = { calls: real.calls, helix: async (p, o) => { if (p.startsWith('/users') && fails-- > 0) throw new Error('No saved tokens'); return real.helix(p, o); } };
  const { client } = makeClient(t, { auth, endpoint: tw.url() });
  client.start();
  await until(() => tw.sockets.length === 1, 3000);
});

test('stop() also closes a migration socket that has not been welcomed', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'session_reconnect', { session: { reconnect_url: tw.url('/reconnect') } });
  await until(() => tw.sockets.length === 2);
  client.stop();
  await until(() => tw.sockets[1].readyState === 3);
});

test('old socket closing mid-migration does not open a competing connection', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const { client, events } = makeClient(t, { endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  tw.send(tw.sockets[0], 'session_reconnect', { session: { reconnect_url: tw.url('/reconnect') } });
  await until(() => tw.sockets.length === 2);
  tw.sockets[0].terminate();
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(tw.sockets.length, 2);
  tw.welcome(tw.sockets[1], 'sess2');
  tw.send(tw.sockets[1], 'notification', chatPayload(), { id: 'after' });
  await until(() => events.chat.length === 1);
  assert.strictEqual(tw.sockets.length, 2);
});

test('subscriptions are requested in parallel so they land inside the 10s window', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const real = fakeAuth();
  let release; const gate = new Promise((r) => { release = r; });
  let inFlight = 0;
  const auth = { calls: real.calls, helix: async (p, o) => {
    if (p === '/eventsub/subscriptions') { inFlight++; await gate; }
    return real.helix(p, o);
  } };
  const { client } = makeClient(t, { auth, endpoint: tw.url() });
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => inFlight === 4);
  release();
});

test('user lookups are batched in groups of 100 logins', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const channels = Array.from({ length: 150 }, (_, i) => `ch${i}`);
  const users = { mybot: '1' }; channels.forEach((c, i) => { users[c] = String(100 + i); });
  const auth = fakeAuth({ users });
  const client = createEventSubClient({
    config: { botUsername: 'mybot', channels }, auth, log: quiet, onChat() {}, onRaid() {}, endpoint: tw.url(), backoff: () => 10,
  });
  t.after(() => client.stop());
  await client.start();
  assert.strictEqual(auth.calls.filter((c) => c.path.startsWith('/users')).length, 2);
  await until(() => tw.sockets.length === 1);
});

test('logs a clear error when no chat subscription could be created', async (t) => {
  const tw = await fakeTwitch(); t.after(tw.close);
  const errors = [];
  const auth = fakeAuth({ failTypes: ['channel.chat.message'] });
  const client = createEventSubClient({
    config: { botUsername: 'mybot', channels: ['chana'] }, auth,
    log: { ...quiet, error: (...a) => errors.push(a.join(' ')) },
    onChat() {}, onRaid() {}, endpoint: tw.url(), backoff: () => 10,
  });
  t.after(() => client.stop());
  await client.start();
  await until(() => tw.sockets.length === 1);
  tw.welcome(tw.sockets[0]);
  await until(() => errors.some((e) => /No chat subscriptions/i.test(e)));
});
