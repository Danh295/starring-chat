const { test } = require('node:test');
const assert = require('node:assert');
const { createOpenAIGetter } = require('../src/openai');

test('no API key -> null, and the SDK is never constructed', () => {
  let constructed = 0;
  const get = createOpenAIGetter({ apiKey: '', OpenAI: function () { constructed++; } });
  assert.strictEqual(get(), null);
  assert.strictEqual(constructed, 0);
});

test('with a key the client is built once with no retries and a short timeout', () => {
  const made = [];
  function Fake(opts) { made.push(opts); this.opts = opts; }
  const get = createOpenAIGetter({ apiKey: 'sk-test', OpenAI: Fake });
  const a = get(); const b = get();
  assert.strictEqual(a, b);
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].maxRetries, 0);
  assert.ok(made[0].timeout <= 5000);
  assert.strictEqual(made[0].apiKey, 'sk-test');
});

test('a constructor failure yields null instead of throwing', () => {
  const get = createOpenAIGetter({ apiKey: 'k', OpenAI: function () { throw new Error('bad'); } });
  assert.strictEqual(get(), null);
});
