'use strict';
const express = require('express');
const { checkPassword } = require('./guard');
const { isValidChannel } = require('./hub');

const LOGIN_RE = /^[a-z0-9_]{1,25}$/;

// Control API for the streamer's control page. Every request needs the password in the
// x-control-password header (never a URL), including from localhost.
function createControlRouter({ config, casting, credits, hub, limiter, log }) {
  const router = express.Router();
  const clientKey = (req) => String(req.headers['cf-connecting-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown');

  // 1. refuse requests that come from another site's page
  router.use((req, res, next) => {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross-site request refused' });
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* treated as mismatch */ }
      if (host !== req.headers.host) return res.status(403).json({ error: 'cross-site request refused' });
    }
    next();
  });

  // 2. password on every request
  router.use((req, res, next) => {
    if (!config.controlPassword) return res.status(503).json({ error: 'Set CONTROL_PASSWORD in .env to use the control page.' });
    const key = clientKey(req);
    if (limiter.blocked(key)) return res.status(429).json({ error: 'Too many wrong passwords. Try again in a minute.' });
    if (!checkPassword(config.controlPassword, req.headers['x-control-password'])) {
      limiter.fail(key);
      return res.status(401).json({ error: 'Wrong or missing password.' });
    }
    next();
  });

  router.use(express.json({ limit: '4kb' }));

  const channelOf = (req) => {
    const raw = (req.method === 'GET' ? req.query.channel : req.body && req.body.channel);
    const c = String(raw || '').toLowerCase();
    return isValidChannel(c) ? c : null;
  };
  const withChannel = (handler) => async (req, res) => {
    const channel = channelOf(req);
    if (!channel) return res.status(400).json({ error: 'bad channel' });
    try { await handler(channel, req, res); } catch (err) {
      log.error('Control action failed:', err.stack || err.message);
      res.status(500).json({ error: 'action failed' });
    }
  };

  router.get('/cast', withChannel((channel, _req, res) => {
    res.json({ episode: casting.getEpisode(channel), paused: casting.isPaused(channel), cast: casting.getCast(channel) });
  }));
  router.post('/test-card', withChannel((channel, _req, res) => {
    const delivered = hub.broadcast(channel, {
      type: 'cast', id: `control-${Date.now()}`, kind: 'cast', user: 'TestCard', login: 'testcard',
      role: 'The Test Subject', logline: 'Appears exactly when the demo needs them.', regular: false,
    });
    res.json({ ok: true, delivered });
  }));
  router.post('/credits', withChannel(async (channel, _req, res) => res.json(await credits.roll(channel))));
  router.post('/pause', withChannel((channel, _req, res) => { casting.setPaused(channel, true); res.json({ ok: true, paused: true }); }));
  router.post('/resume', withChannel((channel, _req, res) => { casting.setPaused(channel, false); res.json({ ok: true, paused: false }); }));
  router.post('/new-episode', withChannel((channel, _req, res) => res.json({ ok: true, episode: casting.startNewEpisode(channel) })));
  router.post('/uncast', withChannel((channel, req, res) => {
    const login = String(req.body.login || '').toLowerCase().replace(/^@/, '');
    if (!LOGIN_RE.test(login)) return res.status(400).json({ error: 'bad login' });
    res.json({ ok: true, removed: casting.uncast(channel, login) });
  }));

  router.use((err, _req, res, _next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'body too large' });
    res.status(400).json({ error: 'bad request' });
  });
  return router;
}

module.exports = { createControlRouter };
