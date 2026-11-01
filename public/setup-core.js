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
  // Live feedback for the channel box: what we understood, or what to fix.
  function channelHint(input) {
    var raw = String(input || '').trim();
    if (!raw) return { state: 'empty', channel: '', message: '' };
    var channel = normalizeChannel(raw);
    if (!channel) {
      var message = /\s/.test(raw)
        ? 'Use just your channel name, like pixelbean.'
        : 'Twitch names use letters, numbers and underscores (up to 25).';
      return { state: 'invalid', channel: '', message: message };
    }
    var cleaned = channel !== raw;
    return { state: 'ok', channel: channel, message: cleaned ? 'Using ' + channel + '.' : 'Looks good: ' + channel + '.' };
  }

  // Browser only: copies text, falling back to a hidden textarea where navigator.clipboard is
  // unavailable (plain http on a LAN). Resolves to true or false so the page can say what happened.
  function copyToClipboard(text) {
    function fallback() {
      try {
        var t = document.createElement('textarea');
        t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        var ok = document.execCommand('copy');
        t.remove();
        return ok;
      } catch (_) { return false; }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      // writeText can hang while the browser waits on a permission. Try the older path after a moment, but if that
      // fails keep waiting for the real answer (up to 8 seconds) instead of throwing a late success away.
      return new Promise(function (resolve) {
        var settled = false;
        var finish = function (ok) { if (!settled) { settled = true; clearTimeout(soon); clearTimeout(late); resolve(ok); } };
        var soon = setTimeout(function () { if (fallback()) finish(true); }, 1500);
        var late = setTimeout(function () { finish(false); }, 8000);
        navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { finish(fallback()); });
      });
    }
    return Promise.resolve(fallback());
  }
  var api = { normalizeChannel: normalizeChannel, overlayUrl: overlayUrl, chatNotice: chatNotice, copyToClipboard: copyToClipboard, channelHint: channelHint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SetupCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
