'use strict';
const path = require('node:path');

const flag = (v) => String(v || '').trim().toLowerCase() === 'true';

function parsePort(v) {
  const s = String(v || '').trim();
  if (!/^\d+$/.test(s)) return 3000;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : 3000;
}

// Reads environment variables into one plain config object.
// Takes `env` as an argument so tests never touch process.env.
function loadConfig(env = process.env) {
  const channels = (env.CHANNELS || '')
    .split(',')
    .map((c) => c.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  const speed = Number(env.DEMO_SPEED);

  return {
    port: parsePort(env.PORT),
    demo: flag(env.DEMO_CHAT),
    channels,
    chatSource: String(env.CHAT_SOURCE || '').trim().toLowerCase() === 'irc' ? 'irc' : 'eventsub',
    botUsername: (env.BOT_USERNAME || '').trim().toLowerCase(),
    twitchClientId: (env.TWITCH_CLIENT_ID || '').trim(),
    twitchClientSecret: (env.TWITCH_CLIENT_SECRET || '').trim(),
    openaiApiKey: (env.OPENAI_API_KEY || '').trim(),
    openaiModel: (env.OPENAI_MODEL || 'gpt-5-mini').trim(),
    controlPassword: env.CONTROL_PASSWORD || '',
    announceInChat: flag(env.ANNOUNCE_IN_CHAT),
    demoSpeed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.resolve(__dirname, '..', 'data'),
    hasTwitchCreds: Boolean((env.TWITCH_CLIENT_ID || '').trim() && (env.TWITCH_CLIENT_SECRET || '').trim()),
    hasOpenAI: Boolean((env.OPENAI_API_KEY || '').trim()),
  };
}

// Human-readable warnings for a live (non-demo) run. Empty array means fine.
function validateConfig(config) {
  if (config.demo) return [];
  const w = [];
  if (!config.channels.length) w.push('CHANNELS is empty: no chat will be read.');
  if (!config.botUsername && config.chatSource === 'eventsub') w.push('BOT_USERNAME is not set.');
  if (!config.hasTwitchCreds && config.chatSource === 'eventsub') w.push('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set.');
  return w;
}

module.exports = { loadConfig, validateConfig };
