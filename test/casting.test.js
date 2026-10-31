const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCastingEngine, hasLink, KNOWN_BOTS } = require('../src/casting');
const { createJsonStore } = require('../src/store');

const quiet = { info() {}, warn() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cast-'));

function setup(over = {}) {
  const dir = over.dir || tmp();
  const emitted = [];
  const announced = [];
  const credits = [];
  let n = 0;
  const roleCalls = [];
  const engine = createCastingEngine({
    config: { botUsername: 'mybot', maxCastPerEpisode: 40, announceInChat: false, resumeWindowMs: 0, ...(over.config || {}) },
    store: createJsonStore(dir),
    roles: over.roles || { writeRole: async (req) => { roleCalls.push(req); return { role: `The Tester ${++n}`.replace(/ \d+$/, ''), logline: 'Tests things.', source: 'ai' }; } },
    emit: (channel, ev) => emitted.push({ channel, ...ev }),
    getCategory: async () => 'Just Chatting',
    announce: async (...a) => announced.push(a),
    onCredits: (c) => credits.push(c),
    log: quiet,
  });
  return { engine, emitted, announced, credits, dir, roleCalls };
}

const msg = (login, text = 'hello everyone', over = {}) => ({
  channel: 'chana', broadcasterId: '10', chatterId: login + '-id', chatterLogin: login, chatterName: login[0].toUpperCase() + login.slice(1),
  text, isBroadcaster: false, isMod: false, messageType: 'text', ...over,
});

test('hasLink catches common link shapes', () => {
  for (const t of ['http://x.com', 'https://x.com/a', 'www.x.com', 'check x.com/path', 'bit.ly/abc', 'go to twitch.tv/foo', 'discord.gg/abc']) assert.ok(hasLink(t), t);
  for (const t of ['hello there', 'i love this game.', 'lol...what', 'v1.2 is out', 'e.g. this']) assert.ok(!hasLink(t), t);
});

test('first message casts a viewer and emits a cast event', async () => {
  const { engine, emitted, roleCalls } = setup();
  const r = await engine.handleChat(msg('pixelbean', 'this snack is great'));
  assert.strictEqual(r.action, 'cast');
  assert.strictEqual(emitted.length, 1);
  const ev = emitted[0];
  assert.strictEqual(ev.type, 'cast');
  assert.strictEqual(ev.channel, 'chana');
  assert.strictEqual(ev.kind, 'cast');
  assert.strictEqual(ev.user, 'Pixelbean');
  assert.strictEqual(ev.login, 'pixelbean');
  assert.strictEqual(ev.role, 'The Tester');
  assert.strictEqual(ev.regular, false);
  assert.strictEqual(ev.episode, 1);
  assert.ok(ev.id);
  assert.strictEqual(roleCalls[0].text, 'this snack is great');
  assert.strictEqual(roleCalls[0].category, 'Just Chatting');
});

test('each viewer is cast once per episode', async () => {
  const { engine, emitted } = setup();
  await engine.handleChat(msg('a'));
  const again = await engine.handleChat(msg('a', 'second message'));
  assert.strictEqual(again.action, 'ignored');
  assert.strictEqual(emitted.length, 1);
});

test('broadcaster, the bot and known bots are never cast', async () => {
  const { engine, emitted } = setup();
  await engine.handleChat(msg('chana', 'hi', { isBroadcaster: true }));
  await engine.handleChat(msg('mybot'));
  for (const b of KNOWN_BOTS) await engine.handleChat(msg(b));
  assert.deepStrictEqual(KNOWN_BOTS, ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'soundalerts', 'wizebot']);
  assert.strictEqual(emitted.length, 0);
});

test('messages with links are skipped and do not use up the viewer\'s casting', async () => {
  const { engine, emitted } = setup();
  assert.strictEqual((await engine.handleChat(msg('a', 'look at https://spam.example/x'))).action, 'ignored');
  assert.strictEqual(emitted.length, 0);
  assert.strictEqual((await engine.handleChat(msg('a', 'ok no link now'))).action, 'cast');
});

test('empty messages and unrelated !commands do not cast', async () => {
  const { engine, emitted } = setup();
  await engine.handleChat(msg('a', '   '));
  await engine.handleChat(msg('a', '!so someone'));
  await engine.handleChat(msg('a', '!hug'));
  assert.strictEqual(emitted.length, 0);
});

test('!lurk casts a Background Extra without calling the role writer', async () => {
  const { engine, emitted, roleCalls } = setup();
  const r = await engine.handleChat(msg('quiet', '!lurk'));
  assert.strictEqual(r.action, 'cast');
  assert.strictEqual(emitted[0].kind, 'lurk');
  assert.match(emitted[0].role, /^The /);
  assert.ok(emitted[0].logline.length > 0);
  assert.strictEqual(roleCalls.length, 0);
  assert.strictEqual((await engine.handleChat(msg('quiet', '!lurk'))).action, 'ignored');
});

test('!lurk after already being cast changes nothing', async () => {
  const { engine, emitted } = setup();
  await engine.handleChat(msg('a'));
  await engine.handleChat(msg('a', '!lurk'));
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].kind, 'cast');
});

test('a raid casts a Guest Star once, mentioning the raid size', async () => {
  const { engine, emitted } = setup();
  const raid = { channel: 'chana', raiderId: '77', raiderLogin: 'raider', raiderName: 'Raider', viewers: 42 };
  assert.strictEqual((await engine.handleRaid(raid)).action, 'cast');
  assert.strictEqual(emitted[0].kind, 'guest');
  assert.strictEqual(emitted[0].user, 'Raider');
  assert.match(emitted[0].logline, /42/);
  assert.strictEqual((await engine.handleRaid(raid)).action, 'ignored');
  assert.strictEqual((await engine.handleChat(msg('raider'))).action, 'ignored', 'guest star is not cast again as a chatter');
});

test('!nocast removes the card, saves the opt-out, and survives a restart', async () => {
  const s = setup();
  await s.engine.handleChat(msg('shy'));
  const r = await s.engine.handleChat(msg('shy', '!nocast'));
  assert.strictEqual(r.action, 'optout');
  assert.ok(s.emitted.some((e) => e.type === 'uncast' && e.login === 'shy'));
  assert.strictEqual((await s.engine.handleChat(msg('shy', 'back again'))).action, 'ignored');
  assert.deepStrictEqual(s.engine.getCast('chana'), []);
  const file = JSON.parse(fs.readFileSync(path.join(s.dir, 'cast-chana.json'), 'utf8'));
  assert.ok(!file.members.shy, 'history removed too');
  const s2 = setup({ dir: s.dir });
  assert.strictEqual((await s2.engine.handleChat(msg('shy', 'new run'))).action, 'ignored');
  assert.strictEqual((await s2.engine.handleChat(msg('shy', '!nocast'))).action, 'optout', 'idempotent');
});

test('opt-outs are per channel', async () => {
  const s = setup();
  await s.engine.handleChat(msg('shy', '!nocast'));
  const r = await s.engine.handleChat(msg('shy', 'hello', { channel: 'chanb', broadcasterId: '11' }));
  assert.strictEqual(r.action, 'cast');
});

test('opted-out raiders are not cast', async () => {
  const s = setup();
  await s.engine.handleChat(msg('raider', '!nocast'));
  const r = await s.engine.handleRaid({ channel: 'chana', raiderLogin: 'raider', raiderName: 'Raider', viewers: 5 });
  assert.strictEqual(r.action, 'ignored');
});

test('!uncast: mods can remove someone for the episode, others cannot', async () => {
  const s = setup();
  await s.engine.handleChat(msg('bob'));
  assert.strictEqual((await s.engine.handleChat(msg('rando', '!uncast @bob'))).action, 'ignored');
  assert.strictEqual(s.engine.getCast('chana').length, 1, 'a non-mod cannot uncast');
  const r = await s.engine.handleChat(msg('themod', '!uncast @Bob', { isMod: true }));
  assert.strictEqual(r.action, 'uncast');
  assert.ok(s.emitted.some((e) => e.type === 'uncast' && e.login === 'bob'));
  assert.strictEqual((await s.engine.handleChat(msg('bob', 'hi again'))).action, 'ignored');
});

test('!newepisode (mod/broadcaster only) starts a fresh episode', async () => {
  const s = setup();
  await s.engine.handleChat(msg('a'));
  assert.strictEqual((await s.engine.handleChat(msg('rando', '!newepisode'))).action, 'ignored');
  const r = await s.engine.handleChat(msg('boss', '!newepisode', { isBroadcaster: true }));
  assert.strictEqual(r.action, 'newepisode');
  assert.strictEqual(r.episode, 2);
  assert.ok(s.emitted.some((e) => e.type === 'episode' && e.episode === 2));
  assert.deepStrictEqual(s.engine.getCast('chana'), []);
  const again = await s.engine.handleChat(msg('a', 'hello again'));
  assert.strictEqual(again.action, 'cast');
  assert.strictEqual(s.emitted.at(-1).episode, 2);
});

test('!credits triggers the credits hook for mods and the broadcaster only', async () => {
  const s = setup();
  await s.engine.handleChat(msg('rando', '!credits'));
  assert.strictEqual(s.credits.length, 0);
  await s.engine.handleChat(msg('themod', '!credits', { isMod: true }));
  await s.engine.handleChat(msg('boss', '!credits', { isBroadcaster: true }));
  assert.deepStrictEqual(s.credits, ['chana', 'chana']);
});

test('returning cast become Series Regulars from their 3rd episode', async () => {
  const dir = tmp();
  for (let run = 1; run <= 3; run++) {
    const s = setup({ dir });
    await s.engine.handleChat(msg('loyal'));
    assert.strictEqual(s.emitted[0].episode, run);
    assert.strictEqual(s.emitted[0].regular, run >= 3, `run ${run}`);
  }
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'cast-chana.json'), 'utf8'));
  assert.strictEqual(file.members.loyal.episodes, 3);
  assert.strictEqual(file.episode, 3);
});

test('two episodes in one run count as two appearances', async () => {
  const s = setup();
  await s.engine.handleChat(msg('a'));
  await s.engine.handleChat(msg('boss', '!newepisode', { isBroadcaster: true }));
  await s.engine.handleChat(msg('a'));
  const file = JSON.parse(fs.readFileSync(path.join(s.dir, 'cast-chana.json'), 'utf8'));
  assert.strictEqual(file.members.a.episodes, 2);
});

test('the per-episode cap stops further casting', async () => {
  const s = setup({ config: { maxCastPerEpisode: 2 } });
  await s.engine.handleChat(msg('a')); await s.engine.handleChat(msg('b'));
  const r = await s.engine.handleChat(msg('c'));
  assert.strictEqual(r.action, 'ignored');
  assert.strictEqual(r.reason, 'cap');
});

test('paused channels do not cast; resuming works', async () => {
  const s = setup();
  s.engine.setPaused('chana', true);
  assert.strictEqual((await s.engine.handleChat(msg('a'))).action, 'ignored');
  s.engine.setPaused('chana', false);
  assert.strictEqual((await s.engine.handleChat(msg('a'))).action, 'cast');
});

test('simultaneous first messages from one viewer cast them once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ roles: { writeRole: async () => { await gate; return { role: 'The Slow One', logline: 'Takes time.', source: 'ai' }; } } });
  const p = [s.engine.handleChat(msg('a')), s.engine.handleChat(msg('a', 'again'))];
  release();
  const results = await Promise.all(p);
  assert.deepStrictEqual(results.map((r) => r.action).sort(), ['cast', 'ignored']);
  assert.strictEqual(s.emitted.filter((e) => e.type === 'cast').length, 1);
});

test('a throwing role writer still casts with a generic role, and handleChat never throws', async () => {
  const s = setup({ roles: { writeRole: async () => { throw new Error('boom'); } } });
  const r = await s.engine.handleChat(msg('a'));
  assert.strictEqual(r.action, 'cast');
  assert.match(s.emitted[0].role, /^The /);
});

test('roles already used this episode are passed to the writer to avoid repeats', async () => {
  const s = setup();
  await s.engine.handleChat(msg('a'));
  await s.engine.handleChat(msg('b'));
  assert.deepStrictEqual(s.roleCalls[1].avoid, ['The Tester']);
});

test('chat announcements are optional and only for chatter casts', async () => {
  const off = setup();
  await off.engine.handleChat(msg('a'));
  assert.strictEqual(off.announced.length, 0);
  const on = setup({ config: { announceInChat: true } });
  await on.engine.handleChat(msg('bob'));
  assert.deepStrictEqual(on.announced[0], ['10', 'Now starring @Bob as The Tester']);
});

test('getCast lists the current episode with Series Regulars first', async () => {
  const dir = tmp();
  await createJsonStore(dir).write('cast-chana.json', { episode: 2, members: { vet: { name: 'Vet', episodes: 2, lastEpisode: 2, role: 'x', logline: 'y' } } });
  const s = setup({ dir });
  await s.engine.handleChat(msg('newbie'));
  await s.engine.handleChat(msg('vet'));
  const cast = s.engine.getCast('chana');
  assert.deepStrictEqual(cast.map((c) => c.login), ['vet', 'newbie']);
  assert.strictEqual(cast[0].regular, true);
});

test('a corrupt cast file does not crash casting', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'cast-chana.json'), '{{{');
  const s = setup({ dir });
  assert.strictEqual((await s.engine.handleChat(msg('a'))).action, 'cast');
});

test('invalid channel names never touch the filesystem', async () => {
  const s = setup();
  const r = await s.engine.handleChat(msg('a', 'hi', { channel: '../evil' }));
  assert.strictEqual(r.action, 'ignored');
  assert.deepStrictEqual(fs.readdirSync(s.dir), []);
});

test('loadFallbackRoles reads the editable file and skips invalid entries', () => {
  const { loadFallbackRoles, DEFAULT_FALLBACKS } = require('../src/roles');
  const dir = tmp();
  assert.deepStrictEqual(loadFallbackRoles(dir), DEFAULT_FALLBACKS);
  fs.writeFileSync(path.join(dir, 'fallback-roles.json'), JSON.stringify([{ role: 'The Custom One', logline: 'Mine.' }, { role: 'bad', logline: 'x' }]));
  assert.deepStrictEqual(loadFallbackRoles(dir), [{ role: 'The Custom One', logline: 'Mine.' }]);
  fs.writeFileSync(path.join(dir, 'fallback-roles.json'), 'nope');
  assert.deepStrictEqual(loadFallbackRoles(dir), DEFAULT_FALLBACKS);
});

test('a restart soon after a stream resumes the same episode and cast', async () => {
  const dir = tmp();
  let t = 1_000_000;
  const a = createCastingEngine({
    config: { botUsername: 'mybot', maxCastPerEpisode: 40, resumeWindowMs: 7200_000 }, store: createJsonStore(dir),
    roles: { writeRole: async () => ({ role: 'The Tester', logline: 'Tests.' }) }, emit() {}, log: quiet, now: () => t,
  });
  await a.handleChat(msg('early'));
  t += 30 * 60_000; // 30 minutes later the app restarts
  const emitted = [];
  const b = createCastingEngine({
    config: { botUsername: 'mybot', maxCastPerEpisode: 40, resumeWindowMs: 7200_000 }, store: createJsonStore(dir),
    roles: { writeRole: async () => ({ role: 'The Tester', logline: 'Tests.' }) }, emit: (c, e) => emitted.push(e), log: quiet, now: () => t,
  });
  assert.strictEqual(b.getEpisode('chana'), 1);
  assert.deepStrictEqual(b.getCast('chana').map((c) => c.login), ['early']);
  assert.strictEqual((await b.handleChat(msg('early', 'again'))).action, 'ignored');
  assert.strictEqual((await b.handleChat(msg('late'))).action, 'cast');
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'cast-chana.json'), 'utf8'));
  assert.strictEqual(file.members.early.episodes, 1, 'not counted twice');
  t += 5 * 3600_000; // much later: a new episode
  const c = createCastingEngine({
    config: { botUsername: 'mybot', maxCastPerEpisode: 40, resumeWindowMs: 7200_000 }, store: createJsonStore(dir),
    roles: { writeRole: async () => ({ role: 'The Tester', logline: 'Tests.' }) }, emit() {}, log: quiet, now: () => t,
  });
  assert.strictEqual(c.getEpisode('chana'), 2);
  assert.deepStrictEqual(c.getCast('chana'), []);
});

test('!newepisode during an in-flight cast does not block that viewer in the new episode', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let first = true;
  const s = setup({ roles: { writeRole: async () => { if (first) { first = false; await gate; } return { role: 'The Late One', logline: 'Slow.' }; } } });
  const slow = s.engine.handleChat(msg('a'));
  await new Promise((r) => setTimeout(r, 10));
  await s.engine.handleChat(msg('boss', '!newepisode', { isBroadcaster: true }));
  const fresh = await s.engine.handleChat(msg('a', 'message in the new episode'));
  assert.strictEqual(fresh.action, 'cast');
  release();
  assert.strictEqual((await slow).action, 'ignored');
  assert.deepStrictEqual(s.engine.getCast('chana').map((c) => c.login), ['a']);
});

test('!uncast gives back the appearance it removed, so no Series Regular progress', async () => {
  const s = setup();
  await s.engine.handleChat(msg('bob'));
  await s.engine.handleChat(msg('themod', '!uncast bob', { isMod: true }));
  await new Promise((r) => setTimeout(r, 20));
  const file = JSON.parse(fs.readFileSync(path.join(s.dir, 'cast-chana.json'), 'utf8'));
  assert.ok(!file.members.bob);
});

test('raids respect a (slightly looser) cap', async () => {
  const s = setup({ config: { maxCastPerEpisode: 1 } });
  await s.engine.handleChat(msg('a'));
  assert.strictEqual((await s.engine.handleRaid({ channel: 'chana', raiderLogin: 'r1', raiderName: 'R1', viewers: 3 })).action, 'cast');
  for (let i = 0; i < 10; i++) await s.engine.handleRaid({ channel: 'chana', raiderLogin: `x${i}`, raiderName: 'X', viewers: 3 });
  const r = await s.engine.handleRaid({ channel: 'chana', raiderLogin: 'last', raiderName: 'Last', viewers: 3 });
  assert.strictEqual(r.reason, 'cap');
});

test('chat links with unusual TLDs or spelled-out dots are skipped; ordinary typos are not', () => {
  for (const t of ['visit spam.store', 'x.info/y', 'free stuff at foo dot com', 'youtu.be/abc', 't.co/xyz']) assert.ok(hasLink(t), t);
  for (const t of ['good.to be honest', 'cya.me', 'see you.Soon']) assert.ok(!hasLink(t), t);
});

test('every cast logs one line with login, role and where the role came from, never the chat text', async () => {
  const lines = [];
  const log = { info: (...a) => lines.push(a.join(' ')), warn() {}, error() {} };
  const mk = (writeRole) => createCastingEngine({
    config: { botUsername: 'mybot', maxCastPerEpisode: 40, resumeWindowMs: 0 }, store: createJsonStore(tmp()),
    roles: { writeRole }, emit() {}, log,
  });
  const ai = mk(async () => ({ role: 'The Snack Critic', logline: 'Fine.', source: 'ai' }));
  await ai.handleChat(msg('bob', 'my secret opinion about spinach'));
  const fb = mk(async () => ({ role: 'The Night Owl', logline: 'Fine.', source: 'fallback', reason: 'timeout' }));
  await fb.handleChat(msg('amy', 'private words here'));
  await fb.handleChat(msg('quiet', '!lurk'));
  assert.ok(lines.some((l) => l.includes('@bob') && l.includes('The Snack Critic') && l.includes('(ai)')));
  assert.ok(lines.some((l) => l.includes('@amy') && l.includes('The Night Owl') && l.includes('(fallback: timeout)')));
  assert.ok(lines.some((l) => l.includes('@quiet') && l.includes('(lurk)')));
  assert.ok(!lines.some((l) => /spinach|private words/.test(l)), 'chat text is never logged');
});
