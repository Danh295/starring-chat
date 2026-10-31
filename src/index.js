'use strict';
require('dotenv').config();
const { loadConfig, validateConfig } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./logger');
const { createTokenStore, createTwitchAuth } = require('./auth');

const config = loadConfig();
const log = createLogger();
validateConfig(config).forEach((w) => log.warn(w));

const auth = config.hasTwitchCreds
  ? createTwitchAuth({ config, store: createTokenStore(config.dataDir) })
  : null;
const app = createApp({ config, auth, log });
const server = app.listen(config.port, () =>
  log.info(`Starring: Chat listening on http://localhost:${config.port}`));
server.on('error', (err) => {
  log.error(`Cannot start server on port ${config.port}:`, err.message);
  process.exit(1);
});

function shutdown() {
  log.info('Shutting down');
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
