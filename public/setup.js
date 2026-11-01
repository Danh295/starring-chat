(function () {
  var $ = function (id) { return document.getElementById(id); };
  var input = $('channel-input');
  var steps = { s1: $('s1'), s2: $('s2'), s3: $('s3'), s4: $('s4') };
  var channel = '';

  function setState(step, state) {
    step.dataset.state = state;
    if (state === 'locked') step.setAttribute('inert', ''); else step.removeAttribute('inert');
  }

  // ---- the live preview: the same card viewers will see ------------------------------------------------
  var SAMPLES = {
    cast: { kind: 'cast', user: 'PixelBean', role: 'The Snack Critic', logline: 'Harsh but fair about snacks.' },
    regular: { kind: 'cast', regular: true, user: 'NightOwl42', role: 'The Night Owl', logline: 'Somehow always awake for the best part.' },
    guest: { kind: 'guest', user: 'RaidMaster', role: 'The Special Guest', logline: 'Arrived with 27 friends in tow.' },
    lurk: { kind: 'lurk', user: 'LurkingLarry', role: 'The Quiet Companion', logline: 'Here for the vibes and the whole episode.' },
  };
  var ORDER = ['cast', 'regular', 'guest', 'lurk'];
  var stage = $('stage');
  var buttons = $('legend').querySelectorAll('button');
  var current = 0;
  var auto = null;
  var revealTimer = null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showSample(tier) {
    current = ORDER.indexOf(tier);
    clearTimeout(revealTimer);
    while (stage.firstChild) stage.removeChild(stage.firstChild);
    var node = CardView.build(SAMPLES[tier]);
    node.classList.add('in');
    stage.appendChild(node);
    revealTimer = setTimeout(function () { CardView.reveal(node); }, reduceMotion ? 0 : CardView.TYPING_MS);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tier === tier)); });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () { clearInterval(auto); auto = null; showSample(b.dataset.tier); });
  });
  showSample('cast');
  if (!reduceMotion) {
    auto = setInterval(function () { if (!document.hidden) showSample(ORDER[(current + 1) % ORDER.length]); }, 7000);
  }

  // ---- step 1: channel, with live feedback --------------------------------------------------------------
  function update() {
    var h = SetupCore.channelHint(input.value);
    var msg = $('channel-msg');
    msg.textContent = h.message;
    msg.className = 'field-msg ' + (h.state === 'ok' ? 'ok' : h.state === 'invalid' ? 'err' : '');
    input.setAttribute('aria-invalid', String(h.state === 'invalid'));
    channel = h.channel;
    if (channel) {
      setState(steps.s1, 'done'); setState(steps.s2, 'active'); setState(steps.s3, 'ready'); setState(steps.s4, 'ready');
      $('url').textContent = SetupCore.overlayUrl(location.origin, channel);
      $('toControl').href = 'control.html?channel=' + encodeURIComponent(channel);
    } else {
      setState(steps.s1, 'active'); setState(steps.s2, 'locked'); setState(steps.s3, 'locked'); setState(steps.s4, 'locked');
      $('test-result').textContent = '';
    }
  }
  input.addEventListener('input', update);
  $('notice').textContent = SetupCore.chatNotice();

  // ---- copy buttons: the button itself confirms ---------------------------------------------------------
  function wireCopy(buttonId, getText, idleLabel) {
    var btn = $(buttonId);
    btn.addEventListener('click', function () {
      SetupCore.copyToClipboard(getText()).then(function (ok) {
        btn.textContent = ok ? 'Copied' : 'Select the text above and copy it';
        btn.classList.toggle('done', ok);
        setTimeout(function () { btn.textContent = idleLabel; btn.classList.remove('done'); }, 3000);
      });
    });
  }
  wireCopy('copy', function () { return $('url').textContent; }, 'Copy link');
  wireCopy('copyNotice', function () { return $('notice').textContent; }, 'Copy message');

  // ---- step 3: a real test card -------------------------------------------------------------------------
  function result(kind, text, linkText, href) {
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
    var preview = 'overlay.html?channel=' + encodeURIComponent(channel) + '&preview=1';
    var btn = $('test');
    btn.disabled = true;
    fetch('test/cast?channel=' + encodeURIComponent(channel) + '&user=You', { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 429) { result('warn', 'Too many attempts. Wait a minute and try again.'); return null; }
        if (res.status === 403) {
          result('warn', 'Test cards can only be sent from the computer running Starring: Chat. Use the control room there instead.', 'Open the control room', 'control.html?channel=' + encodeURIComponent(channel));
          return null;
        }
        if (!res.ok) { result('warn', 'The test did not go through (' + res.status + ').'); return null; }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.delivered > 0) result('ok', 'Sent. Look for the card in OBS.');
        else result('warn', 'The card was sent, but no overlay is open yet. Add the link in OBS, or watch it in a browser tab.', 'Open a preview tab', preview);
      })
      .catch(function () { result('warn', 'Could not reach the server. Is Starring: Chat running?'); })
      .then(function () { btn.disabled = false; });
  });

  var preset = new URLSearchParams(location.search).get('channel');
  if (preset) input.value = preset;
  update();
  if (!preset) input.focus({ preventScroll: true });
})();
