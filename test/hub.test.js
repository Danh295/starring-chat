const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');
const { createHub, isValidChannel } = require('../src/hub');

const quiet = { info() {}, warn() {}, error() {} };
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('timed out');
};

async function setup(t, opts = {}) {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hub = createHub({ server, log: quiet, ...opts });
  t.after(async () => { hub.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const base = `ws://127.0.0.1:${server.address().port}/ws`;
  const open = async (channel) => {
    const ws = new WebSocket(`${base}?channel=${channel}`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (_q, r) => rej(new Error('status ' + r.statusCode))); });
    t.after(() => ws.terminate());
    return { ws, msgs };
  };
  return { hub, open, base };
}

test('isValidChannel accepts Twitch logins only', () => {
  assert.strictEqual(isValidChannel('foo_bar9'), true);
  assert.strictEqual(isValidChannel('Foo'), false);
  assert.strictEqual(isValidChannel(''), false);
  assert.strictEqual(isValidChannel('a'.repeat(26)), false);
  assert.strictEqual(isValidChannel('a b'), false);
  assert.strictEqual(isValidChannel(undefined), false);
});

test('broadcast reaches only clients of that channel', async (t) => {
  const { hub, open } = await setup(t);
  const a = await open('chana'); const b = await open('chanb'); const a2 = await open('chana');
  const events = (c) => c.msgs.filter((m) => m.type !== 'hello');
  hub.broadcast('chana', { type: 'cast', user: 'x' });
  await until(() => events(a).length === 1 && events(a2).length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(events(a)[0], { type: 'cast', user: 'x' });
  assert.strictEqual(events(b).length, 0);
});

test('invalid channel names are refused', async (t) => {
  const { open } = await setup(t);
  await assert.rejects(() => open('Bad%20Name'));
  await assert.rejects(() => open(''));
});

test('connections to other paths are refused', async (t) => {
  const { base } = await setup(t);
  const ws = new WebSocket(base.replace('/ws', '/other?channel=a'));
  await assert.rejects(new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }));
});

test('per-channel client cap', async (t) => {
  const { open } = await setup(t, { maxPerChannel: 2 });
  await open('chana'); await open('chana');
  await assert.rejects(() => open('chana'));
});

test('hello message tells the overlay it is connected', async (t) => {
  const { open } = await setup(t);
  const a = await open('chana');
  await until(() => a.msgs.length === 1);
  assert.deepStrictEqual(a.msgs[0], { type: 'hello', channel: 'chana' });
});

test('client counts and onConnect hook', async (t) => {
  const seen = [];
  const { hub, open } = await setup(t, { onConnect: (c) => seen.push(c) });
  assert.strictEqual(hub.clientCount('chana'), 0);
  const a = await open('chana');
  assert.strictEqual(hub.clientCount('chana'), 1);
  a.ws.close();
  await until(() => hub.clientCount('chana') === 0);
  assert.deepStrictEqual(seen, ['chana']);
});

test('unresponsive clients are dropped by the heartbeat', async (t) => {
  const { hub, open } = await setup(t, { heartbeatMs: 30 });
  const a = await open('chana');
  a.ws.pong = () => {}; // client stops answering pings
  a.ws._receiver.removeAllListeners('ping');
  await until(() => hub.clientCount('chana') === 0, 1500);
});
