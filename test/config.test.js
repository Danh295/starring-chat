const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');

test('defaults: demo off, port 3000, no channels', () => {
  const c = loadConfig({});
  assert.strictEqual(c.port, 3000);
  assert.strictEqual(c.demo, false);
  assert.deepStrictEqual(c.channels, []);
  assert.strictEqual(c.chatSource, 'eventsub');
});

test('parses CHANNELS as lowercase, trimmed, de-hashed list', () => {
  const c = loadConfig({ CHANNELS: ' #Foo, bar ,,BAZ ' });
  assert.deepStrictEqual(c.channels, ['foo', 'bar', 'baz']);
});

test('DEMO_CHAT=true enables demo; other values do not', () => {
  assert.strictEqual(loadConfig({ DEMO_CHAT: 'true' }).demo, true);
  assert.strictEqual(loadConfig({ DEMO_CHAT: 'yes' }).demo, false);
});

test('invalid PORT falls back to 3000', () => {
  assert.strictEqual(loadConfig({ PORT: 'abc' }).port, 3000);
  assert.strictEqual(loadConfig({ PORT: '8080' }).port, 8080);
});

test('CHAT_SOURCE only accepts eventsub or irc', () => {
  assert.strictEqual(loadConfig({ CHAT_SOURCE: 'irc' }).chatSource, 'irc');
  assert.strictEqual(loadConfig({ CHAT_SOURCE: 'nope' }).chatSource, 'eventsub');
});

test('hasTwitchCreds and hasOpenAI reflect env', () => {
  const none = loadConfig({});
  assert.strictEqual(none.hasTwitchCreds, false);
  assert.strictEqual(none.hasOpenAI, false);
  const all = loadConfig({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b', OPENAI_API_KEY: 'k' });
  assert.strictEqual(all.hasTwitchCreds, true);
  assert.strictEqual(all.hasOpenAI, true);
});
