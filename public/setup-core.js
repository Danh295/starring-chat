// Small pure helpers for the setup page (also unit tested in Node).
(function (root) {
  // Accepts "name", "#name", or a twitch.tv URL; returns a lowercase login or '' if invalid.
  function normalizeChannel(input) {
    var s = String(input || '').trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '').replace(/^(www\.)?twitch\.tv\//, '').replace(/^#/, '').replace(/\/.*$/, '');
    return /^[a-z0-9_]{1,25}$/.test(s) ? s : '';
  }
  function overlayUrl(origin, channel) {
    if (!channel) return '';
    return String(origin).replace(/\/+$/, '') + '/overlay.html?channel=' + encodeURIComponent(channel);
  }
  // A chat message the streamer can paste. No links, so chat filters leave it alone.
  function chatNotice() {
    return 'Heads up: this stream uses Starring: Chat, a free overlay that casts chatters in a sitcom. '
      + 'Your first message gets you a role card! Type !lurk to be a Background Extra, or !nocast to opt out and never be cast.';
  }
  var api = { normalizeChannel: normalizeChannel, overlayUrl: overlayUrl, chatNotice: chatNotice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SetupCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
