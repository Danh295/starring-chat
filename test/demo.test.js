const { test } = require('node:test');
const assert = require('node:assert');
const { buildTimeline, createDemo } = require('../src/demo');

test('timeline: 6 chatters, a lurker, a raid and !credits spread over 3 minutes', () => {
  const tl = buildTimeline({ channel: 'demo', speed: 1 });
  const chats = tl.filter((e) => e.type === 'chat' && !e.text.startsWith('!'));
  assert.strictEqual(new Set(chats.map((e) => e.chatterLogin)).size, 6);
  assert.strictEqual(tl.filter((e) => e.type === 'chat' && e.text === '!lurk').length, 1);
  assert.strictEqual(tl.filter((e) => e.type === 'raid').length, 1);
  const credits = tl.filter((e) => e.type === 'chat' && e.text === '!credits');
  assert.strictEqual(credits.length, 1);
  assert.strictEqual(credits[0].isBroadcaster, true);
  assert.strictEqual(credits[0].channel, 'demo');
  assert.deepStrictEqual(tl.map((e) => e.atMs), [...tl.map((e) => e.atMs)].sort((a, b) => a - b));
  assert.strictEqual(tl.at(-1), credits[0], 'credits come last');
  assert.ok(tl.at(-1).atMs > 150_000 && tl.at(-1).atMs <= 180_000);
  assert.ok(tl[0].atMs >= 1000);
});

test('timeline scales with DEMO_SPEED', () => {
  const a = buildTimeline({ channel: 'demo', speed: 1 }).at(-1).atMs;
  const b = buildTimeline({ channel: 'demo', speed: 4 }).at(-1).atMs;
  assert.strictEqual(Math.round(a / 4), b);
});

test('chat events look like real EventSub events (no broadcaster flag, unique ids)', () => {
  const tl = buildTimeline({ channel: 'demo', speed: 1 });
  const first = tl.find((e) => e.type === 'chat');
  assert.deepStrictEqual(Object.keys(first).sort(), ['atMs', 'broadcasterId', 'channel', 'chatterId', 'chatterLogin', 'chatterName', 'isBroadcaster', 'isMod', 'messageType', 'text', 'type']);
  assert.strictEqual(first.isBroadcaster, false);
  const ids = tl.filter((e) => e.type === 'chat').map((e) => e.chatterId);
  assert.ok(new Set(ids).size >= 7);
});

function fakeClock() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cancelled = true; },
    runAll() { for (const t of timers.sort((a, b) => a.ms - b.ms)) if (!t.cancelled) { t.cancelled = true; t.fn(); } },
  };
}

test('runner sends each event to the right handler, once', () => {
  const clock = fakeClock();
  const chats = []; const raids = [];
  const demo = createDemo({ channel: 'demo', speed: 1, onChat: (e) => chats.push(e), onRaid: (e) => raids.push(e), onStart: () => {}, ...clock, log: { info() {} } });
  demo.ensureRunning();
  demo.ensureRunning();
  clock.runAll();
  assert.strictEqual(raids.length, 1);
  assert.ok(chats.length >= 8);
  assert.strictEqual(chats.at(-1).text, '!credits');
  assert.ok(!('atMs' in chats[0]) && !('type' in chats[0]), 'timeline bookkeeping stripped');
});

test('runner starts a fresh episode first, and can run again after it finishes', () => {
  const clock = fakeClock(); let starts = 0; let now = 0;
  const demo = createDemo({ channel: 'demo', speed: 1, onChat() {}, onRaid() {}, onStart: () => { starts++; }, ...clock, now: () => now, cooldownMs: 1000, log: { info() {} } });
  demo.ensureRunning();
  assert.strictEqual(starts, 1);
  demo.ensureRunning();
  assert.strictEqual(starts, 1, 'already running');
  clock.runAll();
  demo.ensureRunning();
  assert.strictEqual(starts, 1, 'still cooling down');
  now = 5000;
  demo.ensureRunning();
  assert.strictEqual(starts, 2);
});

test('stop() cancels everything scheduled', () => {
  const clock = fakeClock(); const chats = [];
  const demo = createDemo({ channel: 'demo', speed: 1, onChat: (e) => chats.push(e), onRaid() {}, onStart() {}, ...clock, log: { info() {} } });
  demo.ensureRunning();
  demo.stop();
  clock.runAll();
  assert.strictEqual(chats.length, 0);
});

test('a throwing handler does not stop the rest of the demo', () => {
  const clock = fakeClock(); let n = 0;
  const demo = createDemo({ channel: 'demo', speed: 1, onChat: () => { n++; throw new Error('x'); }, onRaid() {}, onStart() {}, ...clock, log: { info() {}, error() {} } });
  demo.ensureRunning();
  clock.runAll();
  assert.ok(n >= 8);
});
