(function () {
  var $ = function (id) { return document.getElementById(id); };
  var input = $('channel');
  var current = '';

  function copyText(text, flag) {
    var done = function () { flag.textContent = 'Copied!'; setTimeout(function () { flag.textContent = ''; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else fallback(text, done);
  }
  function fallback(text, done) {
    var t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (_) { /* user can copy by hand */ }
    t.remove();
  }

  function make() {
    var channel = SetupCore.normalizeChannel(input.value);
    if (!channel) {
      $('err').textContent = 'Enter your Twitch channel name (letters, numbers and underscores).';
      $('result').classList.add('hidden');
      return;
    }
    $('err').textContent = '';
    current = SetupCore.overlayUrl(location.origin, channel);
    $('url').textContent = current;
    $('result').classList.remove('hidden');
    $('controlLink').href = 'control.html?channel=' + encodeURIComponent(channel);
  }

  $('make').addEventListener('click', make);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') make(); });
  $('copy').addEventListener('click', function () { if (current) copyText(current, $('copied')); });
  $('notice').textContent = SetupCore.chatNotice();
  $('copyNotice').addEventListener('click', function () { copyText(SetupCore.chatNotice(), $('copiedNotice')); });

  var preset = new URLSearchParams(location.search).get('channel');
  if (preset) { input.value = preset; make(); }
})();
