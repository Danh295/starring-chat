'use strict';
const crypto = require('node:crypto');
const { isLocalRequest } = require('./auth');

const LOOPBACK_RE = /^(127\.|::1$|::ffff:127\.)/;

// Who is calling? cf-connecting-ip is only believed when the connection itself comes from this
// machine (the Cloudflare tunnel); a direct client cannot spoof its way to a fresh limiter bucket.
function clientKey(req) {
  const addr = String((req.socket && req.socket.remoteAddress) || 'unknown');
  const cf = (req.headers || {})['cf-connecting-ip'];
  return LOOPBACK_RE.test(addr) && cf ? String(cf) : addr;
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Constant-time password check. An unset (empty) password never matches.
function checkPassword(expected, given) {
  if (!expected || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(digest(expected), digest(given));
}

// Allows direct localhost requests; anything arriving through a tunnel needs the
// control password in the x-control-password header (never in a URL).
function requireLocalOrPassword(config, limiter) {
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
    const key = clientKey(req);
    if (limiter && limiter.blocked(key)) return res.status(429).send('Too many attempts');
    if (checkPassword(config.controlPassword, req.headers['x-control-password'])) return next();
    if (limiter && req.headers['x-control-password'] !== undefined) limiter.fail(key);
    return res.status(403).send('Forbidden');
  };
}

// Tracks failed password attempts per client so the control password cannot be guessed.
function createAuthLimiter({ max = 10, windowMs = 60_000, now = Date.now, maxKeys = 1000 } = {}) {
  const failures = new Map(); // key -> timestamps of recent failures
  const prune = () => {
    for (const [k, list] of failures) {
      const live = list.filter((t) => now() - t < windowMs);
      if (live.length) failures.set(k, live); else failures.delete(k);
    }
  };
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
      if (failures.size > maxKeys) prune(); // keeps memory bounded when keys never repeat
    },
    size: () => failures.size,
  };
}

module.exports = { checkPassword, requireLocalOrPassword, createAuthLimiter, clientKey, LOOPBACK_RE };
