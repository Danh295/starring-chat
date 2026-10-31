'use strict';
const crypto = require('node:crypto');
const { isLocalRequest } = require('./auth');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Constant-time password check. An unset (empty) password never matches.
function checkPassword(expected, given) {
  if (!expected || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(digest(expected), digest(given));
}

// Allows direct localhost requests; anything arriving through a tunnel needs the
// control password in the x-control-password header (never in a URL).
function requireLocalOrPassword(config) {
  return (req, res, next) => {
    if (isLocalRequest(req)) {
      // Block cross-site pages from poking the local server (CSRF) while allowing
      // direct visits, curl, and same-origin pages.
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return res.status(403).send('Forbidden');
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return res.status(403).send('Forbidden');
      return next();
    }
    if (checkPassword(config.controlPassword, req.headers['x-control-password'])) return next();
    return res.status(403).send('Forbidden');
  };
}

// Tracks failed password attempts per client so the control password cannot be guessed.
function createAuthLimiter({ max = 10, windowMs = 60_000, now = Date.now } = {}) {
  const failures = new Map(); // key -> timestamps of recent failures
  const recent = (key) => {
    const list = (failures.get(key) || []).filter((t) => now() - t < windowMs);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  };
  return {
    blocked: (key) => recent(key).length >= max,
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
  };
}

module.exports = { checkPassword, requireLocalOrPassword, createAuthLimiter };
