'use strict';
require('dotenv').config();
const { loadConfig, validateConfig } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./logger');
const { createChatSource } = require('./chat');
const { createHub } = require('./hub');
const { createTokenStore, createTwitchAuth } = require('./auth');

const config = loadConfig();
const log = createLogger();
validateConfig(config).forEach((w) => log.warn(w));

const auth = config.hasTwitchCreds
  ? createTwitchAuth({ config, store: createTokenStore(config.dataDir) })
  : null;
const hubRef = {};
const app = createApp({ config, auth, log, hub: { broadcast: (...a) => hubRef.hub.broadcast(...a) } });
const server = app.listen(config.port, () =>
  log.info(`Starring: Chat listening on http://localhost:${config.port}`));
hubRef.hub = createHub({ server, log });
server.on('error', (err) => {
  log.error(`Cannot start server on port ${config.port}:`, err.message);
  process.exit(1);
});

// Chat events are only logged for now; casting is wired in a later ticket.
const chat = createChatSource({
  config, auth, log,
  onChat: (e) => log.info(`[${e.channel}] chat message from ${e.chatterLogin}`),
  onRaid: (e) => log.info(`[${e.channel}] raid from ${e.raiderLogin} (${e.viewers})`),
});
if (chat) {
  Promise.resolve(chat.start()).catch((err) => log.error('Chat source failed to start:', err.message));
}

function shutdown() {
  log.info('Shutting down');
  if (chat) chat.stop();
  hubRef.hub.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
