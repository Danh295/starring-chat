const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const quiet = { info() {}, warn() {}, error() {} };

test('public files never mention secrets or token fields', () => {
  const dir = path.join(__dirname, '..', 'public');
  const bad = /access_token|refresh_token|client_secret|sk-[A-Za-z0-9]{20,}/; // env var names in help text are fine; token fields and key values are not
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir).filter((f) => /\.(js|html|css)$/.test(f))) {
    assert.ok(!bad.test(fs.readFileSync(f, 'utf8')), `${f} mentions a secret field`);
  }
});

test('responses carry security headers and a strict CSP', async (t) => {
  const app = createApp({ config: loadConfig({}), log: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/overlay.html`);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'no inline scripts');
  const health = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.strictEqual(health.headers.get('x-content-type-options'), 'nosniff');
});

test('no inline scripts in any page (CSP would block them)', () => {
  const dir = path.join(__dirname, '..', 'public');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f} has an inline script`);
    assert.ok(!/\son\w+="/i.test(html), `${f} has an inline event handler`);
  }
});
