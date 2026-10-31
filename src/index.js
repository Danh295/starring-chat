'use strict';
require('dotenv').config();
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./logger');

const config = loadConfig();
const log = createLogger();
const app = createApp({ config });
app.listen(config.port, () => log.info(`Starring: Chat listening on http://localhost:${config.port}`));
