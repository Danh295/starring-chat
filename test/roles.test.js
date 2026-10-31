const { test } = require('node:test');
const assert = require('node:assert');
const { createRoleWriter, validateRole, DEFAULT_FALLBACKS } = require('../src/roles');

const quiet = { info() {}, warn() {}, error() {} };
const fallbacks = [{ role: 'The Fallback One', logline: 'Always ready.' }, { role: 'The Fallback Two', logline: 'Never late.' }];

function fakeClient({ flagged = false, outputs = [], modFail = false, genFail = false, delayMs = 0, calls = [] } = {}) {
  let i = 0;
  return {
    calls,
    moderations: { create: async (req) => {
      calls.push(['moderation', req]);
      if (modFail) throw new Error('mod down');
      return { results: [{ flagged }] };
    } },
    responses: { create: async (req, opts) => {
      calls.push(['responses', req]);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (genFail) throw new Error('gen down');
      const out = outputs[Math.min(i++, outputs.length - 1)];
      return { output_text: typeof out === 'string' ? out : JSON.stringify(out), status: 'completed' };
    } },
  };
}

const writer = (client, extra = {}) => createRoleWriter({
  getClient: () => client, model: 'test-model', fallbackRoles: fallbacks, log: quiet, timeoutMs: 100, random: () => 0, ...extra,
});

test('validateRole enforces the rules', () => {
  assert.deepStrictEqual(validateRole({ role: 'The Snack Critic', logline: 'Has reviewed every snack on screen.' }),
    { role: 'The Snack Critic', logline: 'Has reviewed every snack on screen.' });
  assert.strictEqual(validateRole({ role: 'Snack Critic', logline: 'x y' }), null, 'must start with The');
  assert.strictEqual(validateRole({ role: 'The', logline: 'x' }), null, '2-4 words');
  assert.strictEqual(validateRole({ role: 'The A B C D', logline: 'x' }), null, '2-4 words');
  assert.strictEqual(validateRole({ role: 'The Critic', logline: 'one two three four five six seven eight nine ten eleven twelve' }), null, 'logline <12 words');
  assert.ok(validateRole({ role: 'The Critic', logline: 'one two three four five six seven eight nine ten eleven' }));
  assert.strictEqual(validateRole({ role: 'The Critic', logline: 'visit http://x.com now' }), null, 'no links');
  assert.strictEqual(validateRole({ role: 'The Critic', logline: 'ask @someone about it' }), null, 'no mentions');
  assert.strictEqual(validateRole({ role: 'The Cri<b>tic', logline: 'fine' }), null, 'no markup');
  assert.strictEqual(validateRole({ role: 'The Critic', logline: '' }), null, 'logline required');
  assert.strictEqual(validateRole(null), null);
  assert.strictEqual(validateRole({ role: 5, logline: 'x' }), null);
});

test('uses the model output when it is valid', async () => {
  const client = fakeClient({ outputs: [{ role: 'The Snack Critic', logline: 'Harsh but fair about snacks.' }] });
  const r = await writer(client).writeRole({ text: 'this snack is mid', category: 'Just Chatting' });
  assert.deepStrictEqual(r, { role: 'The Snack Critic', logline: 'Harsh but fair about snacks.', source: 'ai' });
});

test('prompt carries the message and category, uses structured output, and sets safety rules', async () => {
  const client = fakeClient({ outputs: [{ role: 'The Snack Critic', logline: 'Harsh but fair.' }] });
  await writer(client).writeRole({ text: 'hello snacks', category: 'Minecraft' });
  const gen = client.calls.find((c) => c[0] === 'responses')[1];
  assert.strictEqual(gen.model, 'test-model');
  assert.strictEqual(gen.text.format.type, 'json_schema');
  assert.strictEqual(gen.text.format.strict, true);
  const all = JSON.stringify(gen);
  assert.match(all, /hello snacks/);
  assert.match(all, /Minecraft/);
  assert.match(all, /appearance/i);
  assert.match(all, /untrusted|data, not instructions/i);
});

test('moderation runs first; a flagged message never reaches generation', async () => {
  const client = fakeClient({ flagged: true, outputs: [{ role: 'The X Y', logline: 'z' }] });
  const r = await writer(client).writeRole({ text: 'bad words', category: '' });
  assert.strictEqual(r.source, 'fallback');
  assert.ok(fallbacks.some((f) => f.role === r.role));
  assert.ok(!client.calls.some((c) => c[0] === 'responses'));
});

test('invalid model output falls back', async () => {
  const client = fakeClient({ outputs: [{ role: 'Not Starting With The', logline: 'fine' }] });
  assert.strictEqual((await writer(client).writeRole({ text: 'hi', category: '' })).source, 'fallback');
});

test('malformed JSON falls back', async () => {
  const client = fakeClient({ outputs: ['not json at all'] });
  assert.strictEqual((await writer(client).writeRole({ text: 'hi', category: '' })).source, 'fallback');
});

test('model output is moderated too', async () => {
  let n = 0;
  const client = fakeClient({ outputs: [{ role: 'The Okay Person', logline: 'Seems fine.' }] });
  client.moderations.create = async () => ({ results: [{ flagged: n++ === 1 }] }); // input ok, output flagged
  assert.strictEqual((await writer(client).writeRole({ text: 'hi', category: '' })).source, 'fallback');
});

test('generation errors, missing client and moderation errors all fall back', async () => {
  assert.strictEqual((await writer(fakeClient({ genFail: true, outputs: [{}] })).writeRole({ text: 'hi', category: '' })).source, 'fallback');
  assert.strictEqual((await writer(null).writeRole({ text: 'hi', category: '' })).source, 'fallback');
  assert.strictEqual((await writer(fakeClient({ modFail: true, outputs: [{ role: 'The A B', logline: 'c' }] })).writeRole({ text: 'hi', category: '' })).source, 'fallback');
});

test('anything slower than the budget falls back', async () => {
  const client = fakeClient({ delayMs: 400, outputs: [{ role: 'The Slow Poke', logline: 'Late.' }] });
  const t0 = Date.now();
  const r = await writer(client, { timeoutMs: 60 }).writeRole({ text: 'hi', category: '' });
  assert.strictEqual(r.source, 'fallback');
  assert.ok(Date.now() - t0 < 300);
});

test('fallback avoids roles already used this episode when possible', async () => {
  const w = writer(null);
  const r = await w.writeRole({ text: 'hi', category: '', avoid: ['The Fallback One'] });
  assert.strictEqual(r.role, 'The Fallback Two');
  const r2 = await w.writeRole({ text: 'hi', category: '', avoid: ['The Fallback One', 'The Fallback Two'] });
  assert.ok(r2.role.startsWith('The Fallback'));
});

test('default fallbacks are valid roles', () => {
  assert.ok(DEFAULT_FALLBACKS.length >= 10);
  for (const f of DEFAULT_FALLBACKS) assert.ok(validateRole(f), f.role);
});

test('very long chat messages are truncated before being sent to the model', async () => {
  const client = fakeClient({ outputs: [{ role: 'The Snack Critic', logline: 'Fine.' }] });
  await writer(client).writeRole({ text: 'x'.repeat(5000), category: '' });
  const gen = client.calls.find((c) => c[0] === 'responses')[1];
  assert.ok(JSON.stringify(gen).length < 3000);
});

test('bare domains in model output are rejected', () => {
  for (const l of ['plugs spam.com daily', 'join discord.gg now', 'visit example dot com']) {
    assert.strictEqual(validateRole({ role: 'The Promo Fan', logline: l }), null, l);
  }
});

test('roles already used are listed in the prompt so the model avoids repeats', async () => {
  const client = fakeClient({ outputs: [{ role: 'The New One', logline: 'Fresh.' }] });
  await writer(client).writeRole({ text: 'hi', category: '', avoid: ['The Snack Critic', 'The Night Owl'] });
  const gen = JSON.stringify(client.calls.find((c) => c[0] === 'responses')[1]);
  assert.match(gen, /The Snack Critic/);
  assert.match(gen, /The Night Owl/);
});

test('output token budget leaves room for reasoning models; reasoning effort is opt-in', async () => {
  const client = fakeClient({ outputs: [{ role: 'The New One', logline: 'Fresh.' }] });
  await writer(client).writeRole({ text: 'hi', category: '' });
  let req = client.calls.find((c) => c[0] === 'responses')[1];
  assert.ok(req.max_output_tokens >= 400);
  assert.strictEqual(req.reasoning, undefined);
  const c2 = fakeClient({ outputs: [{ role: 'The New One', logline: 'Fresh.' }] });
  await writer(c2, { reasoningEffort: 'minimal' }).writeRole({ text: 'hi', category: '' });
  req = c2.calls.find((c) => c[0] === 'responses')[1];
  assert.deepStrictEqual(req.reasoning, { effort: 'minimal' });
});

test('fallback results say why: no-client, flagged, invalid, output-flagged, timeout, error', async () => {
  const reason = async (client, extra) => (await writer(client, extra).writeRole({ text: 'hi', category: '' })).reason;
  assert.strictEqual(await reason(null), 'no-client');
  assert.strictEqual(await reason(fakeClient({ flagged: true, outputs: [{}] })), 'flagged');
  assert.strictEqual(await reason(fakeClient({ outputs: [{ role: 'Nope', logline: 'x' }] })), 'invalid');
  assert.strictEqual(await reason(fakeClient({ outputs: ['not json'] })), 'invalid');
  assert.strictEqual(await reason(fakeClient({ genFail: true, outputs: [{}] })), 'error');
  assert.strictEqual(await reason(fakeClient({ delayMs: 400, outputs: [{ role: 'The Slow Poke', logline: 'Late.' }] }), { timeoutMs: 40 }), 'timeout');
  let n = 0;
  const c = fakeClient({ outputs: [{ role: 'The Okay Person', logline: 'Seems fine.' }] });
  c.moderations.create = async () => ({ results: [{ flagged: n++ === 1 }] });
  assert.strictEqual(await reason(c), 'output-flagged');
  const ok = await writer(fakeClient({ outputs: [{ role: 'The Snack Critic', logline: 'Fine.' }] })).writeRole({ text: 'hi', category: '' });
  assert.strictEqual(ok.reason, undefined);
});
