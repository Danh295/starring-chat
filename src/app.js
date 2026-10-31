'use strict';
const path = require('node:path');
const express = require('express');
const { createAuthRouter } = require('./auth');

// Builds the Express app. All dependencies are passed in so tests can fake them.
function createApp({ config, auth, log }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.config = config;
  if (auth) app.use('/auth', createAuthRouter({ auth, log }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}
module.exports = { createApp };
