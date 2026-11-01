'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createAuthRouter } = require('./auth');
const { requireLocalOrPassword, createAuthLimiter } = require('./guard');
const { createControlRouter } = require('./control');
const { isValidChannel } = require('./hub');
const { buildCredits, sampleCast } = require('./credits');

// Builds the Express app. All dependencies are passed in so tests can fake them.
function createApp({ config, auth, log, hub, casting, credits, authLimiter = createAuthLimiter(), artDir = path.join(__dirname, '..', 'public', 'art') }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com", "img-src 'self' data:", "media-src 'self'", "connect-src 'self' ws: wss:",
      "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
    next();
  });
  app.locals.config = config;
  if (auth) app.use('/auth', createAuthRouter({ auth, log }));
  if (hub && casting && credits) {
    app.use('/api/control', createControlRouter({ config, casting, credits, hub, limiter: authLimiter, log: log || console }));
  }
  if (hub) {
    // Fake events for trying the overlay. Localhost only, or the control password through a tunnel.
    app.get('/test/cast', requireLocalOrPassword(config, authLimiter), (req, res) => {
      const channel = String(req.query.channel || '').toLowerCase();
      if (!isValidChannel(channel)) return res.status(400).json({ error: 'bad channel' });
      const user = /^[A-Za-z0-9_]{1,25}$/.test(String(req.query.user || '')) ? String(req.query.user) : 'TestViewer';
      const kind = ['cast', 'guest', 'lurk'].includes(req.query.kind) ? req.query.kind : 'cast';
      const sample = {
        cast: ['The Test Subject', 'Appears exactly when the demo needs them.'],
        guest: ['The Special Guest', 'Arrived with 42 friends in tow.'],
        lurk: ['The Silent Observer', 'Watching every scene from the back row.'],
      }[kind];
      const delivered = hub.broadcast(channel, {
        type: 'cast', id: `test-${Date.now()}`, kind, user, login: user.toLowerCase(),
        role: sample[0], logline: sample[1], regular: kind === 'cast' && req.query.regular === '1',
      });
      res.json({ ok: true, delivered });
    });
    app.get('/test/credits', requireLocalOrPassword(config, authLimiter), (req, res) => {
      const channel = String(req.query.channel || '').toLowerCase();
      if (!isValidChannel(channel)) return res.status(400).json({ error: 'bad channel' });
      const cast = sampleCast(req.query.n);
      const delivered = hub.broadcast(channel, {
        type: 'credits',
        ...buildCredits({ channel, episode: 1, cast, title: 'Episode 1: The One Where the demo went great' }),
      });
      res.json({ ok: true, delivered, total: cast.length });
    });
  }
  // Lets the overlay know which optional hand-drawn art files exist, without 404 probing.
  app.get('/art-manifest', (_req, res) => {
    let files = [];
    try { files = fs.readdirSync(artDir).filter((f) => /\.(png|jpe?g|webp|svg|gif)$/i.test(f)); } catch { /* no art dir */ }
    res.json({ files });
  });
  // The bare address has nothing to show, so it sends people to the setup page (keeping a valid ?channel=).
  app.get('/', (req, res) => {
    const channel = String(req.query.channel || '').toLowerCase();
    res.redirect(isValidChannel(channel) ? `/setup.html?channel=${channel}` : '/setup.html');
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}
module.exports = { createApp };
