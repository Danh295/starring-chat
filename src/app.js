'use strict';
const path = require('node:path');
const express = require('express');
const { createAuthRouter } = require('./auth');
const { requireLocalOrPassword } = require('./guard');
const { isValidChannel } = require('./hub');

// Builds the Express app. All dependencies are passed in so tests can fake them.
function createApp({ config, auth, log, hub }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.config = config;
  if (auth) app.use('/auth', createAuthRouter({ auth, log }));
  if (hub) {
    // Fake events for trying the overlay. Localhost only, or the control password through a tunnel.
    app.get('/test/cast', requireLocalOrPassword(config), (req, res) => {
      const channel = String(req.query.channel || '').toLowerCase();
      if (!isValidChannel(channel)) return res.status(400).json({ error: 'bad channel' });
      const user = /^[A-Za-z0-9_]{1,25}$/.test(String(req.query.user || '')) ? String(req.query.user) : 'TestViewer';
      const delivered = hub.broadcast(channel, {
        type: 'cast', id: `test-${Date.now()}`, kind: 'cast', user,
        role: 'The Test Subject', logline: 'Appears exactly when the demo needs them.',
      });
      res.json({ ok: true, delivered });
    });
  }
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}
module.exports = { createApp };
