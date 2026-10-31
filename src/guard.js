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
    if (isLocalRequest(req)) return next();
    if (checkPassword(config.controlPassword, req.headers['x-control-password'])) return next();
    return res.status(403).send('Forbidden');
  };
}

module.exports = { checkPassword, requireLocalOrPassword };
