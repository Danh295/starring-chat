'use strict';
const path = require('node:path');

const flag = (v) => String(v || '').trim().toLowerCase() === 'true';

// Milliseconds between cards: a whole number, capped at one minute (also keeps setTimeout in range).
function parseInterval(v) {
  const s = String(v || '').trim();
  return /^\d+$/.test(s) ? Math.min(60_000, Number(s)) : 8000;
}

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
    demoChannel: (/^[a-z0-9_]{1,25}$/i.test((env.DEMO_CHANNEL || '').trim()) ? env.DEMO_CHANNEL.trim().toLowerCase() : 'demo'),
    channels,
    chatSource: String(env.CHAT_SOURCE || '').trim().toLowerCase() === 'irc' ? 'irc' : 'eventsub',
    botUsername: (env.BOT_USERNAME || '').trim().toLowerCase(),
    twitchClientId: (env.TWITCH_CLIENT_ID || '').trim(),
    twitchClientSecret: (env.TWITCH_CLIENT_SECRET || '').trim(),
    openaiApiKey: (env.OPENAI_API_KEY || '').trim(),
    openaiReasoningEffort: (env.OPENAI_REASONING_EFFORT || '').trim().toLowerCase(),
    openaiModel: (env.OPENAI_MODEL || 'gpt-5-mini').trim(),
    controlPassword: env.CONTROL_PASSWORD || '',
    announceInChat: flag(env.ANNOUNCE_IN_CHAT),
    maxCastPerEpisode: Number.isInteger(Number(env.MAX_CAST)) && Number(env.MAX_CAST) > 0 ? Number(env.MAX_CAST) : 40,
    cardIntervalMs: parseInterval(env.CARD_INTERVAL_MS),
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

// Command-line flags that override the environment (kept pure: returns a new env object).
function applyCliFlags(argv, env) {
  return argv.slice(2).includes('--demo') ? { ...env, DEMO_CHAT: 'true' } : { ...env };
}

module.exports = { loadConfig, validateConfig, applyCliFlags };
