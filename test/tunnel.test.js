const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');
const { extractTunnelUrl, tunnelArgs, setupInstructions } = require('../src/tunnel');
const { createApp } = require('../src/app');
const { createHub } = require('../src/hub');
const { loadConfig } = require('../src/config');

const quiet = { info() {}, warn() {}, error() {} };

test('extractTunnelUrl finds the trycloudflare URL in cloudflared output', () => {
  assert.strictEqual(extractTunnelUrl('2026-10-31T10:00:00Z INF |  https://quiet-river-1234.trycloudflare.com  |'), 'https://quiet-river-1234.trycloudflare.com');
  assert.strictEqual(extractTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...'), null);
  assert.strictEqual(extractTunnelUrl('https://evil.example.com/x'), null);
  assert.strictEqual(extractTunnelUrl(''), null);
});

test('tunnelArgs points cloudflared at the local port', () => {
  assert.deepStrictEqual(tunnelArgs(3000), ['tunnel', '--url', 'http://localhost:3000']);
  assert.deepStrictEqual(tunnelArgs('8080'), ['tunnel', '--url', 'http://localhost:8080']);
  assert.throws(() => tunnelArgs('abc'), /port/i);
});

test('setupInstructions lists the pages to open through the tunnel', () => {
  const text = setupInstructions('https://quiet-river-1234.trycloudflare.com');
  assert.match(text, /https:\/\/quiet-river-1234\.trycloudflare\.com\/setup\.html/);
  assert.match(text, /changes every time/i);
});

// Requests arrive through the tunnel with a public Host and Cloudflare headers.
const TUNNEL = { host: 'quiet-river-1234.trycloudflare.com', 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7' };
const viaTunnel = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, headers: { ...TUNNEL, ...headers } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject); req.end();
});

async function boot(t, env = {}) {
  const config = loadConfig({ CHANNELS: 'chana', ...env });
  const http2 = http.createServer();
  const hub = createHub({ server: http2, log: quiet });
  const app = createApp({ config, log: quiet, hub, casting: { getCast: () => [], getEpisode: () => 1, isPaused: () => false, setPaused() {}, startNewEpisode: () => 2, uncast: () => true }, credits: { roll: async () => ({ rolled: true }) } });
  http2.on('request', app);
  await new Promise((r) => http2.listen(0, '127.0.0.1', r));
  t.after(() => { hub.close(); http2.closeAllConnections(); http2.close(); });
  return http2.address().port;
}

test('through the tunnel: pages and the overlay websocket work', async (t) => {
  const port = await boot(t);
  for (const p of ['/health', '/overlay.html', '/setup.html', '/control.html', '/overlay.js', '/art-manifest']) {
    assert.strictEqual((await viaTunnel(port, p)).status, 200, p);
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?channel=chana`, { headers: TUNNEL });
  t.after(() => ws.terminate());
  const hello = await new Promise((res, rej) => { ws.on('message', (d) => res(JSON.parse(d.toString()))); ws.on('error', rej); });
  assert.deepStrictEqual(hello, { type: 'hello', channel: 'chana' });
});

test('through the tunnel: login and test routes are closed, control needs the password', async (t) => {
  const port = await boot(t, { CONTROL_PASSWORD: 'pw', TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' });
  assert.strictEqual((await viaTunnel(port, '/test/cast?channel=chana')).status, 403);
  assert.strictEqual((await viaTunnel(port, '/test/credits?channel=chana')).status, 403);
  assert.strictEqual((await viaTunnel(port, '/api/control/cast?channel=chana')).status, 401);
  assert.strictEqual((await viaTunnel(port, '/api/control/cast?channel=chana', { 'x-control-password': 'pw' })).status, 200);
});

test('through the tunnel: /auth is closed even with a localhost Host header', async (t) => {
  const config = loadConfig({ CHANNELS: 'chana', TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' });
  const { createTwitchAuth, createTokenStore } = require('../src/auth');
  const app = createApp({ config, log: quiet, auth: createTwitchAuth({ config, store: createTokenStore(require('node:os').tmpdir()), fetch: async () => { throw new Error('no network'); } }) });
  const server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  assert.strictEqual((await viaTunnel(port, '/auth')).status, 403);
  assert.strictEqual((await viaTunnel(port, '/auth/callback?code=x&state=y')).status, 403);
  assert.strictEqual((await viaTunnel(port, '/auth', { host: 'localhost:3000' })).status, 403, 'proxy headers alone are enough to refuse');
});
