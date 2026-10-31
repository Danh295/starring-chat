'use strict';
const http = require('node:http');
const { createApp } = require('./app');
const { createChatSource } = require('./chat');
const { createHub } = require('./hub');
const { createTokenStore, createTwitchAuth } = require('./auth');
const { createJsonStore } = require('./store');
const { createOpenAIGetter } = require('./openai');
const { createRoleWriter, loadFallbackRoles } = require('./roles');
const { createCastingEngine } = require('./casting');
const { createCategoryLookup } = require('./category');
const { createAnnouncer } = require('./announce');
const { createTitleWriter, createCreditsRoller } = require('./credits');
const { createPacer } = require('./pacer');
const { createDemo } = require('./demo');

// Wires the whole app together. index.js starts it; tests start it with a demo config.
function createRuntime({ config, log }) {
  const auth = config.hasTwitchCreds
    ? createTwitchAuth({ config, store: createTokenStore(config.dataDir) })
    : null;

  let demo = null;
  const server = http.createServer();
  const hub = createHub({
    server, log,
    onConnect: (channel) => { if (demo && channel === config.demoChannel) demo.ensureRunning(); },
  });
  const pacer = createPacer({ emit: (channel, ev) => hub.broadcast(channel, ev), intervalMs: config.cardIntervalMs });

  const getOpenAI = createOpenAIGetter({ apiKey: config.openaiApiKey });
  const roles = createRoleWriter({
    getClient: getOpenAI, model: config.openaiModel, reasoningEffort: config.openaiReasoningEffort,
    fallbackRoles: loadFallbackRoles(config.dataDir), log,
  });
  const categoryFor = auth ? createCategoryLookup({ auth }) : async () => '';
  const broadcasterIds = new Map(); // channel -> broadcaster id, learned from chat events
  const announcer = auth && config.announceInChat ? createAnnouncer({ auth, config, log }) : null;
  let creditsRoller = null;

  const casting = createCastingEngine({
    config, store: createJsonStore(config.dataDir), roles,
    emit: (channel, ev) => pacer.emit(channel, ev),
    getCategory: categoryFor,
    onCredits: (channel) => { creditsRoller.roll(channel).catch((err) => log.error('Credits failed:', err.message)); },
    announce: announcer ? (id, text) => announcer.send(id, text) : undefined,
    log,
  });

  creditsRoller = createCreditsRoller({
    getCast: (c) => casting.getCast(c),
    getEpisode: (c) => casting.getEpisode(c),
    writeTitle: createTitleWriter({ getClient: getOpenAI, model: config.openaiModel, reasoningEffort: config.openaiReasoningEffort, log }).writeTitle,
    getCategory: (c) => categoryFor(broadcasterIds.get(c)),
    emit: (channel, ev) => pacer.emit(channel, ev),
    lockDivisor: config.demo ? config.demoSpeed : 1,
    log,
  });

  const app = createApp({ config, auth, log, hub, casting, credits: creditsRoller });
  server.on('request', app);

  // A failure while handling one chat event is logged and never reaches the chat connection.
  const safe = (name, fn) => (e) => {
    try { Promise.resolve(fn(e)).catch((err) => log.error(`${name} failed:`, err.stack || err.message)); } catch (err) {
      log.error(`${name} failed:`, err.stack || err.message);
    }
  };
  const onChat = safe('Chat handler', (e) => {
    if (e.broadcasterId) broadcasterIds.set(e.channel, e.broadcasterId);
    return casting.handleChat(e);
  });
  const onRaid = safe('Raid handler', (e) => casting.handleRaid(e));

  if (config.demo) {
    demo = createDemo({
      channel: config.demoChannel, speed: config.demoSpeed, onChat, onRaid, log,
      // a replay starts a fresh episode; the very first run keeps Episode 1
      onStart: () => { if (casting.getCast(config.demoChannel).length) casting.startNewEpisode(config.demoChannel); },
    });
  }
  const chat = createChatSource({ config, auth, log, onChat, onRaid });

  return {
    server, hub, casting, creditsRoller,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.removeListener('error', reject);
          const actual = server.address().port;
          log.info(`Starring: Chat listening on http://localhost:${actual}`);
          if (config.demo) log.info(`Demo mode: open http://localhost:${actual}/overlay.html?channel=${config.demoChannel} to start the show`);
          if (chat) Promise.resolve(chat.start()).catch((err) => log.error('Chat source failed to start:', err.message));
          resolve(server);
        });
      });
    },
    stop() {
      if (demo) demo.stop();
      pacer.stop();
      if (chat) chat.stop();
      hub.close();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createRuntime };
