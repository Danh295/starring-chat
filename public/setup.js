// The setup page: a live preview of the real card, then a route of four steps that unlock one after another.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var input = $('channel-input');
  var stops = [$('s1'), $('s2'), $('s3'), $('s4')];
  var channel = '';

  // ---- the route: each stop is current, done, ready or locked, and says so to a screen reader too
  var STATE_WORDS = { current: ' (current step)', done: ' (done)', locked: ' (locked until step 1 is done)', ready: '' };
  function setState(stop, state) {
    stop.dataset.state = state;
    // a locked stop stays readable (its heading and the reason are announced); only its buttons switch off
    stop.querySelectorAll('button').forEach(function (b) { b.disabled = state === 'locked'; });
    if (state === 'current') stop.setAttribute('aria-current', 'step'); else stop.removeAttribute('aria-current');
    stop.querySelector('.state-note').textContent = STATE_WORDS[state];
  }
  function announce(text) { var live = $('live'); live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }

  // ---- the preview: the same card viewers see, one tier at a time
  var SAMPLES = {
    cast: { kind: 'cast', user: 'PixelBean', role: 'The Snack Critic', logline: 'Harsh but fair about snacks.' },
    regular: { kind: 'cast', regular: true, user: 'NightOwl42', role: 'The Night Owl', logline: 'Somehow always awake for the best part.' },
    guest: { kind: 'guest', user: 'RaidMaster', role: 'The Special Guest', logline: 'Arrived with 27 friends in tow.' },
    lurk: { kind: 'lurk', user: 'LurkingLarry', role: 'The Quiet Companion', logline: 'Here for the vibes and the whole episode.' },
  };
  var CAPTIONS = {
    cast: 'A chatter’s first message in a stream gets this card.',
    regular: 'A chatter who has come back for their 3rd episode gets this card.',
    guest: 'Someone who raids your channel gets this card.',
    lurk: 'Someone who types !lurk gets this card.',
  };
  var stage = $('stage');
  var revealTimer = null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function showSample(tier) {
    clearTimeout(revealTimer);
    while (stage.firstChild) stage.removeChild(stage.firstChild);
    var card = CardView.build(SAMPLES[tier]);
    stage.appendChild(card);
    revealTimer = setTimeout(function () { CardView.reveal(card); }, reduceMotion ? 0 : CardView.TYPING_MS);
    $('caption').textContent = CAPTIONS[tier];
  }
  document.querySelectorAll('input[name="tier"]').forEach(function (r) {
    r.addEventListener('change', function () { showSample(r.value); });
  });
  showSample('cast');

  // ---- step 1: the channel, with feedback as you type
  function update() {
    var hint = SetupCore.channelHint(input.value);
    var msg = $('channel-msg');
    msg.textContent = hint.message;
    msg.className = 'field-msg ' + (hint.state === 'ok' ? 'ok' : hint.state === 'invalid' ? 'err' : '');
    input.setAttribute('aria-invalid', String(hint.state === 'invalid'));
    var was = channel;
    channel = hint.channel;
    if (channel && channel !== was) announce('Channel set to ' + channel + '. Steps 2, 3 and 4 are ready.');
    if (channel) {
      setState(stops[0], 'done'); setState(stops[1], 'current'); setState(stops[2], 'ready'); setState(stops[3], 'ready');
      $('url').value = SetupCore.overlayUrl(location.origin, channel);
      $('toControl').href = 'control.html?channel=' + encodeURIComponent(channel);
    } else {
      setState(stops[0], 'current'); setState(stops[1], 'locked'); setState(stops[2], 'locked'); setState(stops[3], 'locked');
      $('test-result').textContent = '';
    }
  }
  input.addEventListener('input', update);
  $('notice').value = SetupCore.chatNotice();
  ['url', 'notice'].forEach(function (id) { $(id).addEventListener('focus', function () { $(id).select(); }); });

  // ---- copy buttons: the button says what happened, and a screen reader hears it
  function wireCopy(buttonId, getText, idleLabel) {
    var btn = $(buttonId);
    var timer = null;
    btn.addEventListener('click', function () {
      SetupCore.copyToClipboard(getText()).then(function (ok) {
        btn.textContent = ok ? 'Copied' : 'Select the text above and copy it';
        btn.classList.toggle('done', ok);
        announce(ok ? 'Copied to the clipboard.' : 'Could not copy. Select the text and copy it by hand.');
        clearTimeout(timer);
        timer = setTimeout(function () { btn.textContent = idleLabel; btn.classList.remove('done'); }, 3000);
      });
    });
  }
  wireCopy('copy', function () { return $('url').value; }, 'Copy link');
  wireCopy('copyNotice', function () { return $('notice').value; }, 'Copy message');

  // ---- step 3: a real test card, and an honest answer
  function say(kind, text, linkText, href) {
    var box = $('test-result');
    while (box.firstChild) box.removeChild(box.firstChild);
    box.className = 'result ' + kind;
    box.appendChild(document.createTextNode(text));
    if (linkText) {
      box.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = href; a.textContent = linkText; a.target = '_blank'; a.rel = 'noopener';
      box.appendChild(a);
    }
  }
  $('test').addEventListener('click', function () {
    if (!channel) return;
    var btn = $('test');
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Sending...';
    var ch = encodeURIComponent(channel);
    fetch('test/cast?channel=' + ch + '&user=You', { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 429) { say('err', 'Too many attempts. Wait a minute and try again.'); return null; }
        if (res.status === 403) { say('err', 'Test cards can only be sent from the computer running Starring: Chat. Use the control room there instead.', 'Open the control room', 'control.html?channel=' + ch); return null; }
        if (!res.ok) { say('err', 'The test did not go through. Check that Starring: Chat is running, then try again.'); return null; }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.delivered > 0) say('ok', 'Sent. Look for the card in OBS.');
        else say('err', 'The card was sent, but no overlay is open yet. Add the link in OBS, or watch it in a browser tab.', 'Open a preview tab', 'overlay.html?channel=' + ch + '&preview=1');
      })
      .catch(function () { say('err', 'Could not reach the server. Is Starring: Chat running?'); })
      .then(function () { btn.removeAttribute('aria-busy'); btn.textContent = 'Send a test card'; });
  });

  var preset = new URLSearchParams(location.search).get('channel');
  if (preset) input.value = preset;
  update();
  if (!preset) input.focus({ preventScroll: true });
})();
