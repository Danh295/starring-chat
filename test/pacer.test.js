const { test } = require('node:test');
const assert = require('node:assert');
const { createPacer } = require('../src/pacer');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cast = (login) => ({ type: 'cast', login, user: login });

function make(intervalMs = 40, extra = {}) {
  const sent = [];
  const pacer = createPacer({ emit: (ch, ev) => { sent.push({ ch, t: Date.now(), ...ev }); return 1; }, intervalMs, ...extra });
  return { pacer, sent };
}

test('the first card goes out immediately; later cards wait one interval each, in order', async () => {
  const { pacer, sent } = make(40);
  const t0 = Date.now();
  pacer.emit('c', cast('a')); pacer.emit('c', cast('b')); pacer.emit('c', cast('c'));
  assert.deepStrictEqual(sent.map((s) => s.login), ['a']);
  await wait(130);
  assert.deepStrictEqual(sent.map((s) => s.login), ['a', 'b', 'c']);
  assert.ok(sent[1].t - sent[0].t >= 35, 'b waited');
  assert.ok(sent[2].t - sent[1].t >= 35, 'c waited');
  assert.ok(sent[0].t - t0 < 20);
  pacer.stop();
});

test('nothing is dropped: every cast event is delivered', async () => {
  const { pacer, sent } = make(10);
  for (let i = 0; i < 8; i++) pacer.emit('c', cast('u' + i));
  const end = Date.now() + 3000;
  while (sent.length < 8 && Date.now() < end) await wait(10);
  assert.strictEqual(sent.length, 8);
  pacer.stop();
});

test('channels are paced independently', async () => {
  const { pacer, sent } = make(60);
  pacer.emit('one', cast('a')); pacer.emit('two', cast('b'));
  assert.strictEqual(sent.length, 2);
  pacer.stop();
});

test('non-card events pass through immediately and return the emit result', () => {
  const { pacer, sent } = make(1000);
  pacer.emit('c', cast('a')); pacer.emit('c', cast('b'));
  const r = pacer.emit('c', { type: 'hello' });
  assert.strictEqual(r, 1);
  assert.deepStrictEqual(sent.map((s) => s.type), ['cast', 'hello']);
  pacer.stop();
});

test('uncast removes that viewer\'s waiting card and is forwarded', async () => {
  const { pacer, sent } = make(40);
  pacer.emit('c', cast('a')); pacer.emit('c', cast('b')); pacer.emit('c', cast('c'));
  pacer.emit('c', { type: 'uncast', login: 'b' });
  await wait(120);
  assert.deepStrictEqual(sent.filter((s) => s.type === 'cast').map((s) => s.login), ['a', 'c']);
  assert.ok(sent.some((s) => s.type === 'uncast' && s.login === 'b'));
  pacer.stop();
});

test('a new episode or credits clears waiting cards', async () => {
  for (const type of ['episode', 'credits']) {
    const { pacer, sent } = make(40);
    pacer.emit('c', cast('a')); pacer.emit('c', cast('b')); pacer.emit('c', cast('c'));
    pacer.emit('c', { type });
    await wait(100);
    assert.deepStrictEqual(sent.filter((s) => s.type === 'cast').map((s) => s.login), ['a'], type);
    assert.ok(sent.some((s) => s.type === type));
    pacer.stop();
  }
});

test('the waiting queue is capped, dropping the oldest', async () => {
  const { pacer, sent } = make(5, { maxQueue: 3 });
  pacer.emit('c', cast('first'));
  for (let i = 0; i < 6; i++) pacer.emit('c', cast('q' + i));
  await wait(80);
  assert.deepStrictEqual(sent.map((s) => s.login), ['first', 'q3', 'q4', 'q5']);
  pacer.stop();
});

test('intervalMs 0 disables pacing', () => {
  const { pacer, sent } = make(0);
  pacer.emit('c', cast('a')); pacer.emit('c', cast('b'));
  assert.strictEqual(sent.length, 2);
});

test('stop() cancels pending sends', async () => {
  const { pacer, sent } = make(30);
  pacer.emit('c', cast('a')); pacer.emit('c', cast('b'));
  pacer.stop();
  await wait(80);
  assert.strictEqual(sent.length, 1);
});

test('a new episode resets pacing so its first card is not held behind the old one', async () => {
  const { pacer, sent } = make(200);
  pacer.emit('c', cast('a'));            // goes out now, next slot in 200ms
  pacer.emit('c', { type: 'episode' });
  pacer.emit('c', cast('b'));            // new episode: should go out immediately
  assert.deepStrictEqual(sent.filter((s) => s.type === 'cast').map((s) => s.login), ['a', 'b']);
  pacer.stop();
});

test('dropping the oldest waiting card is reported through onDrop', () => {
  const dropped = [];
  const { pacer } = make(1000, { maxQueue: 2, onDrop: (ch, ev) => dropped.push([ch, ev.login]) });
  pacer.emit('c', cast('first'));
  for (const l of ['a', 'b', 'c']) pacer.emit('c', cast(l));
  assert.deepStrictEqual(dropped, [['c', 'a']]);
  pacer.stop();
});
