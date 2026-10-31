const { test } = require('node:test');
const assert = require('node:assert');
const { createChatSource } = require('../src/chat');
const { loadConfig } = require('../src/config');

const quiet = { info() {}, warn() {}, error() {} };
const base = { log: quiet, onChat() {}, onRaid() {} };

test('demo mode never starts a real chat source', () => {
  assert.strictEqual(createChatSource({ ...base, config: loadConfig({ DEMO_CHAT: 'true', CHANNELS: 'a' }), auth: {} }), null);
});

test('no channels -> no chat source', () => {
  assert.strictEqual(createChatSource({ ...base, config: loadConfig({}), auth: {} }), null);
});

test('eventsub without Twitch credentials -> no chat source', () => {
  assert.strictEqual(createChatSource({ ...base, config: loadConfig({ CHANNELS: 'a', BOT_USERNAME: 'b' }), auth: null }), null);
});

test('eventsub with credentials -> client with start/stop', () => {
  const c = createChatSource({ ...base, config: loadConfig({ CHANNELS: 'a', BOT_USERNAME: 'b', TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y' }), auth: { helix() {} } });
  assert.strictEqual(typeof c.start, 'function');
  assert.strictEqual(typeof c.stop, 'function');
});

test('irc source needs only channels', () => {
  const c = createChatSource({ ...base, config: loadConfig({ CHAT_SOURCE: 'irc', CHANNELS: 'a' }), auth: null });
  assert.strictEqual(typeof c.start, 'function');
});
