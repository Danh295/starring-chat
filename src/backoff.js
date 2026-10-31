'use strict';
// Exponential backoff: 1s, 2s, 4s ... capped at 30s.
const defaultBackoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt);
module.exports = { defaultBackoff };
