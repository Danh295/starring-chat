'use strict';
// Reads environment variables into one plain config object.
// Takes `env` as an argument so tests never touch process.env.

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT, 10);
  const channels = (env.CHANNELS || '')
    .split(',')
    .map((c) => c.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  const chatSource = env.CHAT_SOURCE === 'irc' ? 'irc' : 'eventsub';

  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    demo: env.DEMO_CHAT === 'true',
    channels,
    chatSource,
    botUsername: (env.BOT_USERNAME || '').toLowerCase(),
    twitchClientId: env.TWITCH_CLIENT_ID || '',
    twitchClientSecret: env.TWITCH_CLIENT_SECRET || '',
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-5-mini',
    controlPassword: env.CONTROL_PASSWORD || '',
    announceInChat: env.ANNOUNCE_IN_CHAT === 'true',
    demoSpeed: Number(env.DEMO_SPEED) > 0 ? Number(env.DEMO_SPEED) : 1,
    dataDir: env.DATA_DIR || 'data',
    hasTwitchCreds: Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET),
    hasOpenAI: Boolean(env.OPENAI_API_KEY),
  };
}

module.exports = { loadConfig };
