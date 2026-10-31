'use strict';
require('dotenv').config();
const { loadConfig, validateConfig } = require('./config');
const { createLogger } = require('./logger');
const { createRuntime } = require('./runtime');

const config = loadConfig();
const log = createLogger();
validateConfig(config).forEach((w) => log.warn(w));

const runtime = createRuntime({ config, log });
runtime.listen().catch((err) => {
  log.error(`Cannot start server on port ${config.port}:`, err.message);
  process.exit(1);
});

// One bad promise must not take the stream down; a truly unexpected crash is logged, then we exit.
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason && reason.stack ? reason.stack : reason));
process.on('uncaughtException', (err) => { log.error('Uncaught exception:', err.stack || err.message); process.exit(1); });

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  log.info('Shutting down');
  const hardExit = setTimeout(() => { log.warn('Shutdown timed out'); process.exit(1); }, 3000);
  hardExit.unref();
  Promise.resolve()
    .then(() => runtime.stop())
    .then(() => process.exit(0), (err) => { log.error('Shutdown failed:', err.stack || err.message); process.exit(1); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
