const { test } = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createApp } = require('../src/app');
const { createHub } = require('../src/hub');
const { loadConfig } = require('../src/config');

const quiet = { info() {}, warn() {}, error() {} };

async function boot(t, env = {}) {
  const config = loadConfig(env);
  const hubRef = {};
  const app = createApp({ config, log: quiet, hub: { broadcast: (...a) => hubRef.hub.broadcast(...a) } });
  const server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
  hubRef.hub = createHub({ server, log: quiet });
  t.after(async () => { hubRef.hub.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const port = server.address().port;
  return { base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}` };
}

test('end to end: /test/cast reaches an overlay websocket for that channel', async (t) => {
  const { base, wsBase } = await boot(t);
  const ws = new WebSocket(`${wsBase}/ws?channel=chana`);
  t.after(() => ws.terminate());
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  const res = await fetch(`${base}/test/cast?channel=chana&user=Pixel_Bean`);
  assert.deepStrictEqual(await res.json(), { ok: true, delivered: 1 });
  await new Promise((r) => setTimeout(r, 50));
  const cast = msgs.find((m) => m.type === 'cast');
  assert.strictEqual(cast.user, 'Pixel_Bean');
  assert.match(cast.role, /^The /);
});

test('/test/cast rejects bad channels and sanitizes the user name', async (t) => {
  const { base } = await boot(t);
  assert.strictEqual((await fetch(`${base}/test/cast?channel=Bad Name`)).status, 400);
  assert.strictEqual((await fetch(`${base}/test/cast`)).status, 400);
  const ok = await fetch(`${base}/test/cast?channel=chana&user=${encodeURIComponent('<script>x</script>')}`);
  assert.strictEqual(ok.status, 200);
});

test('/test/cast is blocked through a tunnel without the password, allowed with it', async (t) => {
  const { base } = await boot(t, { CONTROL_PASSWORD: 'pw' });
  const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
  assert.strictEqual((await fetch(`${base}/test/cast?channel=a`, { headers: tunnel })).status, 403);
  assert.strictEqual((await fetch(`${base}/test/cast?channel=a`, { headers: { ...tunnel, 'x-control-password': 'bad' } })).status, 403);
  assert.strictEqual((await fetch(`${base}/test/cast?channel=a`, { headers: { ...tunnel, 'x-control-password': 'pw' } })).status, 200);
});

test('/test/cast can preview guest, lurk and regular cards; bad kinds fall back to cast', async (t) => {
  const { base, wsBase } = await boot(t);
  const ws = new WebSocket(`${wsBase}/ws?channel=chana`);
  t.after(() => ws.terminate());
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  await fetch(`${base}/test/cast?channel=chana&kind=guest`);
  await fetch(`${base}/test/cast?channel=chana&kind=lurk`);
  await fetch(`${base}/test/cast?channel=chana&kind=cast&regular=1`);
  await fetch(`${base}/test/cast?channel=chana&kind=evil`);
  await new Promise((r) => setTimeout(r, 80));
  const casts = msgs.filter((m) => m.type === 'cast');
  assert.deepStrictEqual(casts.map((c) => c.kind), ['guest', 'lurk', 'cast', 'cast']);
  assert.deepStrictEqual(casts.map((c) => c.regular), [false, false, true, false]);
  assert.strictEqual(casts[0].role, 'The Special Guest');
});
