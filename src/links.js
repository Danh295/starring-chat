'use strict';

// Detects links in chat text and model output: explicit schemes, www., well-known shorteners,
// domain-looking words with a common TLD, and spelled-out "dot com".
const LINK_RE = new RegExp([
  'https?:\\/\\/',
  'www\\.',
  '\\b(?:bit\\.ly|t\\.co|tinyurl\\.com|youtu\\.be|discord\\.gg)\\b',
  '\\b[a-z0-9-]+\\.(?:com|net|org|io|tv|gg|app|xyz|dev|link|info|biz|store|online|site|live|tech|shop|page|ca|uk|de|ru|cn)\\b',
  '\\bdot\\s*(?:com|net|org|gg|tv)\\b',
].join('|'), 'i');

const hasLink = (text) => LINK_RE.test(String(text));

module.exports = { hasLink };
