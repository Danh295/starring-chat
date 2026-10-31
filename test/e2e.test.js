const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createRuntime } = require('../src/runtime');
const { loadConfig } = require('../src/config');

const quiet = { info() {}, warn() {}, error() {} };
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out waiting for condition');
};

test('DEMO_CHAT=true runs end to end with no Twitch or OpenAI keys: cards, then credits', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  const config = loadConfig({ DEMO_CHAT: 'true', PORT: '1', DATA_DIR: dataDir, DEMO_SPEED: '300', CARD_INTERVAL_MS: '5', CONTROL_PASSWORD: 'pw' });
  const rt = createRuntime({ config, log: quiet });
  await rt.listen(0);
  t.after(() => rt.stop());
  const port = rt.server.address().port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?channel=demo`);
  t.after(() => ws.terminate());
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));

  await until(() => msgs.some((m) => m.type === 'credits'));
  const casts = msgs.filter((m) => m.type === 'cast');
  assert.ok(casts.length >= 8, `got ${casts.length} cards`);
  assert.deepStrictEqual([...new Set(casts.map((c) => c.kind))].sort(), ['cast', 'guest', 'lurk']);
  for (const c of casts) assert.match(c.role, /^The /);
  const credits = msgs.find((m) => m.type === 'credits');
  assert.match(credits.title, /^Episode \d+: The One /);
  assert.ok(credits.starring.length >= 6);
  assert.strictEqual(credits.guests.length, 1);
  assert.strictEqual(credits.extras.length, 1);
  assert.strictEqual(credits.directedBy, 'demo');
  const castIdx = msgs.findIndex((m) => m.type === 'cast');
  assert.ok(castIdx < msgs.findIndex((m) => m.type === 'credits'), 'cards come before the credits');
});

test('the demo starts when an overlay connects, not before', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  const config = loadConfig({ DEMO_CHAT: 'true', DATA_DIR: dataDir, DEMO_SPEED: '300', CARD_INTERVAL_MS: '5' });
  const rt = createRuntime({ config, log: quiet });
  await rt.listen(0);
  t.after(() => rt.stop());
  await new Promise((r) => setTimeout(r, 200));
  const files = fs.readdirSync(dataDir);
  assert.ok(!files.some((f) => f.startsWith('cast-')), 'nothing cast before an overlay connects');
});

test('the control API sees the demo cast and enforces the password', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  const config = loadConfig({ DEMO_CHAT: 'true', DATA_DIR: dataDir, DEMO_SPEED: '300', CARD_INTERVAL_MS: '5', CONTROL_PASSWORD: 'pw' });
  const rt = createRuntime({ config, log: quiet });
  await rt.listen(0);
  t.after(() => rt.stop());
  const base = `http://127.0.0.1:${rt.server.address().port}`;
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?channel=demo`);
  t.after(() => ws.terminate());
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await until(() => got.some((m) => m.type === 'credits'));
  assert.strictEqual((await fetch(`${base}/api/control/cast?channel=demo`)).status, 401);
  const res = await fetch(`${base}/api/control/cast?channel=demo`, { headers: { 'x-control-password': 'pw' } });
  const j = await res.json();
  assert.ok(j.cast.length >= 8);
});

test('the first demo run is Episode 1; a replay becomes the next episode with a clean cast', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  const config = loadConfig({ DEMO_CHAT: 'true', DATA_DIR: dataDir, DEMO_SPEED: '400', CARD_INTERVAL_MS: '0' });
  const rt = createRuntime({ config, log: quiet });
  await rt.listen(0);
  t.after(() => rt.stop());
  const port = rt.server.address().port;
  const runOnce = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?channel=demo`);
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await until(() => got.some((m) => m.type === 'credits'));
    ws.terminate();
    return got.find((m) => m.type === 'credits');
  };
  const first = await runOnce();
  assert.match(first.title, /^Episode 1:/);
  await new Promise((r) => setTimeout(r, 400)); // demo cooldown (60s / speed)
  const second = await runOnce();
  assert.match(second.title, /^Episode 2:/);
  assert.strictEqual(second.starring.length, first.starring.length, 'a clean cast, not doubled');
});
