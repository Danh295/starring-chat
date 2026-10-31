'use strict';
require('dotenv').config();
const http = require('node:http');
const { loadConfig, validateConfig } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./logger');
const { createChatSource } = require('./chat');
const { createHub } = require('./hub');
const { createTokenStore, createTwitchAuth } = require('./auth');
const { createJsonStore } = require('./store');
const { createOpenAIGetter } = require('./openai');
const { createRoleWriter, loadFallbackRoles } = require('./roles');
const { createCastingEngine } = require('./casting');
const { createCategoryLookup } = require('./category');
const { createAnnouncer } = require('./announce');

const config = loadConfig();
const log = createLogger();
validateConfig(config).forEach((w) => log.warn(w));

const auth = config.hasTwitchCreds
  ? createTwitchAuth({ config, store: createTokenStore(config.dataDir) })
  : null;

const server = http.createServer();
const hub = createHub({ server, log });

const roles = createRoleWriter({
  getClient: createOpenAIGetter({ apiKey: config.openaiApiKey }),
  model: config.openaiModel,
  fallbackRoles: loadFallbackRoles(config.dataDir),
  log,
});
const announcer = auth && config.announceInChat ? createAnnouncer({ auth, config, log }) : null;
const casting = createCastingEngine({
  config,
  store: createJsonStore(config.dataDir),
  roles,
  emit: (channel, event) => hub.broadcast(channel, event),
  getCategory: auth ? createCategoryLookup({ auth }) : async () => '',
  announce: announcer ? (id, text) => announcer.send(id, text) : undefined,
  log,
});

const app = createApp({ config, auth, log, hub, casting });
server.on('request', app);
server.listen(config.port, () =>
  log.info(`Starring: Chat listening on http://localhost:${config.port}`));
server.on('error', (err) => {
  log.error(`Cannot start server on port ${config.port}:`, err.message);
  process.exit(1);
});

const chat = createChatSource({
  config, auth, log,
  onChat: (e) => { casting.handleChat(e); },
  onRaid: (e) => { casting.handleRaid(e); },
});
if (chat) {
  Promise.resolve(chat.start()).catch((err) => log.error('Chat source failed to start:', err.message));
}

function shutdown() {
  log.info('Shutting down');
  if (chat) chat.stop();
  hub.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
