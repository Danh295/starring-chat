const { test } = require('node:test');
const assert = require('node:assert');
const { buildCredits, createTitleWriter, createCreditsRoller, sampleCast } = require('../src/credits');

const quiet = { info() {}, warn() {}, error() {} };
const member = (login, kind, over = {}) => ({ login, name: login[0].toUpperCase() + login.slice(1), kind, role: 'The ' + login, logline: 'x', regular: false, episode: 1, ...over });

test('buildCredits groups by kind, keeps Series Regulars first, and fills the fixed lines', () => {
  const cast = [member('vet', 'cast', { regular: true }), member('newbie', 'cast'), member('raider', 'guest'), member('ghost', 'lurk')];
  const c = buildCredits({ channel: 'chana', episode: 3, cast, title: 'Episode 3: The One Where Everyone Showed Up' });
  assert.strictEqual(c.title, 'Episode 3: The One Where Everyone Showed Up');
  assert.deepStrictEqual(c.starring.map((x) => [x.user, x.role]), [['Vet', 'The vet'], ['Newbie', 'The newbie']]);
  assert.strictEqual(c.starring[0].regular, true);
  assert.deepStrictEqual(c.guests.map((x) => x.user), ['Raider']);
  assert.deepStrictEqual(c.extras.map((x) => x.user), ['Ghost']);
  assert.strictEqual(c.directedBy, 'chana');
  assert.strictEqual(c.castingBy, 'Starring: Chat');
  assert.strictEqual(c.total, 4);
  assert.strictEqual(c.compact, false);
  assert.strictEqual(c.scrollMs, 45000);
});

test('buildCredits: more than 30 cast members switches to the compact, same-length scroll', () => {
  const cast = Array.from({ length: 31 }, (_, i) => member('u' + i, 'cast'));
  const c = buildCredits({ channel: 'a', episode: 1, cast, title: 't' });
  assert.strictEqual(c.compact, true);
  assert.strictEqual(c.scrollMs, 45000);
  assert.strictEqual(buildCredits({ channel: 'a', episode: 1, cast: cast.slice(0, 30), title: 't' }).compact, false);
});

test('buildCredits uses the fallback title when none is given', () => {
  assert.strictEqual(buildCredits({ channel: 'a', episode: 7, cast: [], title: '' }).title, 'Episode 7: The One With Everyone');
});

const fakeClient = ({ phrase = 'the snacks got reviewed', flagged = false, fail = false, delayMs = 0, calls = [] } = {}) => ({
  calls,
  moderations: { create: async (r) => { calls.push(['mod', r]); return { results: [{ flagged }] }; } },
  responses: { create: async (r) => {
    calls.push(['gen', r]);
    if (delayMs) await new Promise((x) => setTimeout(x, delayMs));
    if (fail) throw new Error('down');
    return { output_text: JSON.stringify({ phrase }) };
  } },
});
const tw = (client, extra = {}) => createTitleWriter({ getClient: () => client, model: 'm', log: quiet, timeoutMs: 100, ...extra });

test('title writer builds "Episode N: The One Where ..." from a valid phrase', async () => {
  const client = fakeClient();
  const t = await tw(client).writeTitle({ episode: 4, category: 'Minecraft', roles: ['The Snack Critic', 'The Night Owl'] });
  assert.strictEqual(t, 'Episode 4: The One Where the snacks got reviewed');
  const gen = JSON.stringify(client.calls.find((c) => c[0] === 'gen')[1]);
  assert.match(gen, /Minecraft/); assert.match(gen, /The Snack Critic/); assert.match(gen, /PG/);
});

test('title writer falls back on bad phrases, flags, errors, timeouts and missing clients', async () => {
  const fb = 'Episode 2: The One With Everyone';
  for (const client of [
    fakeClient({ phrase: 'visit spam.com now' }), fakeClient({ phrase: 'x' }), fakeClient({ phrase: 'a b c d e f g h i j k l m n o p q' }),
    fakeClient({ flagged: true }), fakeClient({ fail: true }), null,
  ]) assert.strictEqual(await tw(client).writeTitle({ episode: 2, category: '', roles: [] }), fb);
  assert.strictEqual(await tw(fakeClient({ delayMs: 400 }), { timeoutMs: 40 }).writeTitle({ episode: 2, category: '', roles: [] }), fb);
});

function rollerSetup(over = {}) {
  const emitted = [];
  const cast = over.cast || [member('a', 'cast'), member('b', 'guest')];
  const roller = createCreditsRoller({
    getCast: () => cast, getEpisode: () => 5, writeTitle: async () => 'Episode 5: The One Where it worked',
    emit: (ch, ev) => emitted.push({ ch, ...ev }), log: quiet, now: over.now || (() => 0), cooldownExtraMs: 1000,
  });
  return { roller, emitted };
}

test('roll() emits one credits event for the channel', async () => {
  const { roller, emitted } = rollerSetup();
  const r = await roller.roll('chana');
  assert.strictEqual(r.rolled, true);
  assert.strictEqual(emitted[0].type, 'credits');
  assert.strictEqual(emitted[0].ch, 'chana');
  assert.strictEqual(emitted[0].title, 'Episode 5: The One Where it worked');
  assert.strictEqual(emitted[0].directedBy, 'chana');
});

test('roll() does not stack: a second roll during the scroll is refused', async () => {
  let t = 0;
  const { roller, emitted } = rollerSetup({ now: () => t });
  await roller.roll('chana');
  t = 10_000;
  assert.strictEqual((await roller.roll('chana')).rolled, false);
  t = 45_000 + 1000 + 1;
  assert.strictEqual((await roller.roll('chana')).rolled, true);
  assert.strictEqual(emitted.length, 2);
});

test('roll() with an empty cast rolls nothing', async () => {
  const { roller, emitted } = rollerSetup({ cast: [] });
  const r = await roller.roll('chana');
  assert.deepStrictEqual([r.rolled, r.reason], [false, 'empty']);
  assert.strictEqual(emitted.length, 0);
});

test('sampleCast makes a mixed cast of the requested size (capped)', () => {
  const c = sampleCast(12);
  assert.strictEqual(c.length, 12);
  assert.ok(c.some((m) => m.kind === 'guest') && c.some((m) => m.kind === 'lurk') && c.some((m) => m.regular));
  assert.strictEqual(sampleCast(9999).length, 80);
  assert.strictEqual(sampleCast('abc').length, 12);
});

test('roll() never throws: a failing getCast reports an error and frees the slot', async () => {
  let boom = true; const emitted = [];
  const roller = createCreditsRoller({
    getCast: () => { if (boom) throw new Error('boom'); return [member('a', 'cast')]; },
    getEpisode: () => 1, writeTitle: async () => 't', emit: (c, e) => { emitted.push(e); return 1; }, log: quiet, now: () => 0,
  });
  const r = await roller.roll('chana');
  assert.deepStrictEqual([r.rolled, r.reason], [false, 'error']);
  boom = false;
  assert.strictEqual((await roller.roll('chana')).rolled, true);
});

test('roll() with no overlay connected frees the slot so a mod can retry', async () => {
  let listeners = 0; const emitted = [];
  const roller = createCreditsRoller({
    getCast: () => [member('a', 'cast')], getEpisode: () => 1, writeTitle: async () => 't',
    emit: (c, e) => { emitted.push(e); return listeners; }, log: quiet, now: () => 0,
  });
  const r = await roller.roll('chana');
  assert.deepStrictEqual([r.rolled, r.reason], [false, 'no-overlay']);
  listeners = 1;
  assert.strictEqual((await roller.roll('chana')).rolled, true);
});
