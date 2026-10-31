'use strict';
const { createEventSubClient } = require('./eventsub');
const { createIrcClient } = require('./irc');

// Picks the live chat reader for the current config, or null when none should run
// (demo mode, no channels, or EventSub without Twitch credentials).
function createChatSource({ config, auth, log, onChat, onRaid }) {
  if (config.demo) return null;
  if (!config.channels.length) return null;
  if (config.chatSource === 'irc') return createIrcClient({ config, log, onChat, onRaid });
  if (!config.hasTwitchCreds || !auth) return null;
  return createEventSubClient({ config, auth, log, onChat, onRaid });
}

module.exports = { createChatSource };
