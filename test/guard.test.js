const { test } = require('node:test');
const assert = require('node:assert');
const { checkPassword, requireLocalOrPassword } = require('../src/guard');

const res = () => { const r = { code: 200, sent: null, status(c) { r.code = c; return r; }, send(b) { r.sent = b; return r; } }; return r; };
const req = (headers = {}, host = 'localhost:3000') => ({ headers: { host, ...headers }, socket: { remoteAddress: '127.0.0.1' } });

test('checkPassword compares in constant time and rejects unset passwords', () => {
  assert.strictEqual(checkPassword('secret', 'secret'), true);
  assert.strictEqual(checkPassword('secret', 'secreT'), false);
  assert.strictEqual(checkPassword('secret', 'sec'), false);
  assert.strictEqual(checkPassword('', ''), false);
  assert.strictEqual(checkPassword('secret', undefined), false);
});

test('localhost is allowed without a password', () => {
  let called = false;
  requireLocalOrPassword({ controlPassword: 'pw' })(req(), res(), () => { called = true; });
  assert.ok(called);
});

test('through a tunnel the password header is required', () => {
  const mw = requireLocalOrPassword({ controlPassword: 'pw' });
  const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
  let r = res(); let called = false;
  mw(req(tunnel, 'x.trycloudflare.com'), r, () => { called = true; });
  assert.strictEqual(r.code, 403); assert.strictEqual(called, false);
  r = res(); mw(req({ ...tunnel, 'x-control-password': 'wrong' }, 'x.trycloudflare.com'), r, () => { called = true; });
  assert.strictEqual(r.code, 403);
  r = res(); mw(req({ ...tunnel, 'x-control-password': 'pw' }, 'x.trycloudflare.com'), r, () => { called = true; });
  assert.strictEqual(called, true);
});

test('with no password configured, tunnel access is always refused', () => {
  const r = res(); let called = false;
  requireLocalOrPassword({ controlPassword: '' })(req({ 'cf-connecting-ip': '1.2.3.4', 'x-control-password': '' }, 'x.trycloudflare.com'), r, () => { called = true; });
  assert.strictEqual(r.code, 403); assert.strictEqual(called, false);
});
