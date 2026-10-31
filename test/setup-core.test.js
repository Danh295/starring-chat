const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeChannel, overlayUrl, chatNotice } = require('../public/setup-core');

test('normalizeChannel accepts twitch names, urls and #names; rejects junk', () => {
  assert.strictEqual(normalizeChannel(' PixelBean '), 'pixelbean');
  assert.strictEqual(normalizeChannel('#pixel_bean'), 'pixel_bean');
  assert.strictEqual(normalizeChannel('https://www.twitch.tv/PixelBean'), 'pixelbean');
  assert.strictEqual(normalizeChannel('twitch.tv/pixelbean/'), 'pixelbean');
  assert.strictEqual(normalizeChannel('bad name'), '');
  assert.strictEqual(normalizeChannel('<script>'), '');
  assert.strictEqual(normalizeChannel(''), '');
  assert.strictEqual(normalizeChannel('a'.repeat(30)), '');
});

test('overlayUrl builds a browser-source URL from the page origin', () => {
  assert.strictEqual(overlayUrl('https://abc.trycloudflare.com', 'pixelbean'), 'https://abc.trycloudflare.com/overlay.html?channel=pixelbean');
  assert.strictEqual(overlayUrl('http://localhost:3000/', 'x'), 'http://localhost:3000/overlay.html?channel=x');
  assert.strictEqual(overlayUrl('http://localhost:3000', ''), '');
});

test('chatNotice explains the overlay and how to opt out', () => {
  const m = chatNotice();
  assert.match(m, /!nocast/);
  assert.match(m, /Starring: Chat/);
  assert.ok(m.length <= 500, 'fits in one Twitch chat message');
  assert.ok(!/https?:\/\//.test(m), 'no links, so chat filters do not eat it');
});
