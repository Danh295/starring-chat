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

test('env values are trimmed and case-insensitive', () => {
  assert.strictEqual(loadConfig({ CHAT_SOURCE: ' IRC ' }).chatSource, 'irc');
  assert.strictEqual(loadConfig({ DEMO_CHAT: 'True' }).demo, true);
  assert.strictEqual(loadConfig({ ANNOUNCE_IN_CHAT: ' TRUE' }).announceInChat, true);
});

test('PORT must be a whole number in 1-65535', () => {
  assert.strictEqual(loadConfig({ PORT: '8080abc' }).port, 3000);
  assert.strictEqual(loadConfig({ PORT: '70000' }).port, 3000);
  assert.strictEqual(loadConfig({ PORT: '65535' }).port, 65535);
});

test('DEMO_SPEED must be finite and positive', () => {
  assert.strictEqual(loadConfig({ DEMO_SPEED: 'Infinity' }).demoSpeed, 1);
  assert.strictEqual(loadConfig({ DEMO_SPEED: '4' }).demoSpeed, 4);
});

test('dataDir resolves to an absolute path independent of cwd', () => {
  const path = require('node:path');
  assert.ok(path.isAbsolute(loadConfig({}).dataDir));
  assert.strictEqual(loadConfig({ DATA_DIR: '/tmp/x' }).dataDir, '/tmp/x');
});

test('validateConfig warns about missing live-mode settings, nothing in demo', () => {
  const { validateConfig } = require('../src/config');
  assert.deepStrictEqual(validateConfig(loadConfig({ DEMO_CHAT: 'true' })), []);
  const w = validateConfig(loadConfig({}));
  assert.ok(w.some((m) => /CHANNELS/.test(m)));
  assert.ok(w.some((m) => /TWITCH_CLIENT_ID/.test(m)));
  assert.deepStrictEqual(
    validateConfig(loadConfig({ CHANNELS: 'a', BOT_USERNAME: 'b', TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y' })), []);
});

test('MAX_CAST sets the per-episode cap, default 40', () => {
  assert.strictEqual(loadConfig({}).maxCastPerEpisode, 40);
  assert.strictEqual(loadConfig({ MAX_CAST: '12' }).maxCastPerEpisode, 12);
  assert.strictEqual(loadConfig({ MAX_CAST: '-3' }).maxCastPerEpisode, 40);
});
