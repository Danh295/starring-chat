(function () {
  var $ = function (id) { return document.getElementById(id); };
  var input = $('channel-input');
  var current = '';

  function copyText(text, flag) {
    SetupCore.copyToClipboard(text).then(function (ok) {
      flag.textContent = ok ? 'Copied!' : 'Could not copy. Select the text and copy it by hand.';
      setTimeout(function () { flag.textContent = ''; }, 3500);
    });
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
    var ctl = 'control.html?channel=' + encodeURIComponent(channel);
    $('controlLink').href = ctl;
    $('controlTile').href = ctl;
  }

  $('make').addEventListener('click', make);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') make(); });
  $('copy').addEventListener('click', function () { if (current) copyText(current, $('copied')); });
  $('notice').textContent = SetupCore.chatNotice();
  $('copyNotice').addEventListener('click', function () { copyText(SetupCore.chatNotice(), $('copiedNotice')); });

  var preset = new URLSearchParams(location.search).get('channel');
  if (preset) { input.value = preset; make(); }
})();
