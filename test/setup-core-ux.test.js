const { test } = require('node:test');
const assert = require('node:assert');
const { channelHint } = require('../public/setup-core');

test('channelHint: empty input says nothing', () => {
  assert.deepStrictEqual(channelHint(''), { state: 'empty', channel: '', message: '' });
  assert.deepStrictEqual(channelHint('   '), { state: 'empty', channel: '', message: '' });
});

test('channelHint: a good name is accepted', () => {
  const h = channelHint('PixelBean');
  assert.strictEqual(h.state, 'ok');
  assert.strictEqual(h.channel, 'pixelbean');
  assert.match(h.message, /pixelbean/);
});

test('channelHint: pasted links and #names are cleaned up and the user is told', () => {
  const h = channelHint('https://www.twitch.tv/PixelBean');
  assert.strictEqual(h.state, 'ok');
  assert.strictEqual(h.channel, 'pixelbean');
  assert.match(h.message, /Using pixelbean/);
});

test('channelHint: bad input explains what is allowed', () => {
  const spaces = channelHint('pixel bean');
  assert.strictEqual(spaces.state, 'invalid');
  assert.match(spaces.message, /just your channel name/i);
  const symbols = channelHint('pixel$bean');
  assert.strictEqual(symbols.state, 'invalid');
  assert.match(symbols.message, /letters, numbers/i);
  assert.strictEqual(channelHint('a'.repeat(30)).state, 'invalid');
});
