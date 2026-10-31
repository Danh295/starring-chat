const { test } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

async function withServer(fn) {
  const app = createApp({ config: loadConfig({}) });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}

test('GET /health returns ok', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });
});

test('overlay page is served', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/overlay.html`);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /Starring: Chat/);
  });
});
