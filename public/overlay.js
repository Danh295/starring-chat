// The OBS browser source. Connects to the server and shows cast cards one at a time, then rolls the credits.
(function () {
  var params = new URLSearchParams(location.search);
  var channel = (params.get('channel') || '').toLowerCase();
  if (params.has('preview')) document.body.classList.add('preview'); // a plain backdrop, to look at it in a normal browser tab
  var stage = document.getElementById('stage');
  var statusEl = document.getElementById('status');
  var creditsEl = document.getElementById('credits');
  var HOLD_MS = 7000;               // how long a card stays
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // How long the leave animation runs: read from the same CSS token, and none when motion is reduced.
  function exitMs() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    var v = getComputedStyle(document.documentElement).getPropertyValue('--dur-short').trim();
    return v.slice(-2) === 'ms' ? parseFloat(v) + 30 : 250;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // never innerHTML: chat text is untrusted
    return e;
  }

  // ---- optional hand-drawn art: drop PNGs in public/art/ and they are used. The server lists what exists.
  var ART = { 'card-frame.png': ['has-frame-art', '--frame-art'], 'stamp.png': ['has-stamp-art', '--stamp-art'], 'background.png': ['has-bg-art', '--bg-art'] };
  function loadArt() {
    fetch('art-manifest').then(function (r) { return r.json(); }).then(function (m) {
      (m.files || []).forEach(function (file) {
        var spec = ART[file];
        if (!spec) return;
        document.body.classList.add(spec[0]);
        document.documentElement.style.setProperty(spec[1], 'url("art/' + file + '")');
      });
    }).catch(function () { /* art is optional */ });
  }
  loadArt();

  // ---- cards, one at a time
  var nodes = new Map();   // card event -> its element
  var timers = new Map();  // card event -> its reveal timer
  var queue = OverlayCore.createCardQueue({
    show: function (c) {
      var node = CardView.build(c);
      stage.appendChild(node);
      nodes.set(c, node);
      node.classList.add('enter');
      timers.set(c, setTimeout(function () {
        if (!nodes.has(c)) return; // removed before the reveal: no sting
        CardView.reveal(node);
        OverlaySound.playSting();
      }, CardView.TYPING_MS));
    },
    wait: function (_c, skipped) {
      return new Promise(function (resolve) {
        var t = setTimeout(resolve, CardView.TYPING_MS + HOLD_MS);
        skipped.then(function () { clearTimeout(t); resolve(); });
      });
    },
    hide: function (c) {
      var node = nodes.get(c);
      nodes.delete(c);
      clearTimeout(timers.get(c));
      timers.delete(c);
      if (!node) return undefined;
      node.classList.remove('enter');
      node.classList.add('leave');
      return sleep(exitMs()).then(function () { node.remove(); });
    },
  });

  // ---- the credits: a departures board
  var creditsActive = false;
  var deferred = []; // cards for people cast while the credits roll are shown after

  function row(parent, p, tier) {
    var r = el('div', 'row tier-' + tier);
    r.appendChild(el('div', 'line-square', OverlayCore.initialOf(p.user)));
    r.appendChild(el('span', 'row-name', p.user));
    if (p.regular) r.appendChild(el('span', 'row-tag', 'Series regular'));
    r.appendChild(el('span', 'row-role', p.role));
    parent.appendChild(r);
  }
  function board(parent, heading, list, extra, tierFor) {
    if (!list.length) return;
    var head = el('h2', 'board-head');
    head.appendChild(el('span', '', heading));
    head.appendChild(el('span', '', String(list.length)));
    parent.appendChild(head);
    var box = el('div', extra);
    list.forEach(function (p) { row(box, p, tierFor(p)); });
    parent.appendChild(box);
  }

  function rollCredits(msg) {
    if (creditsActive) return;
    var m = OverlayCore.creditsModel(msg);
    creditsActive = true;
    queue.reset();
    while (creditsEl.firstChild) creditsEl.removeChild(creditsEl.firstChild);
    creditsEl.className = m.compact ? 'compact' : '';
    var roll = el('div', 'roll');
    roll.style.animationDuration = m.scrollMs + 'ms';
    roll.appendChild(el('h1', 'roll-title', m.title));
    board(roll, 'Starring', m.starring, 'board-stars', function (p) { return p.regular ? 'regular' : 'cast'; });
    board(roll, 'Special guest stars', m.guests, 'board-guests', function () { return 'guest'; });
    board(roll, 'Background extras', m.extras, 'board-extras', function () { return 'lurk'; });
    if (m.directedBy) {
      var head = el('h2', 'board-head'); head.appendChild(el('span', '', 'Directed by')); roll.appendChild(head);
      row(roll, { user: m.directedBy, role: '', regular: false }, 'regular');
    }
    var off = el('p', 'sign-off', 'Casting by ');
    off.appendChild(el('b', '', m.castingBy));
    roll.appendChild(off);
    creditsEl.appendChild(roll);
    creditsEl.classList.add('on');
    OverlaySound.playTheme(m.scrollMs);
    setTimeout(function () {
      OverlaySound.stopTheme();
      creditsEl.classList.remove('on');
      while (creditsEl.firstChild) creditsEl.removeChild(creditsEl.firstChild);
      creditsActive = false;
      deferred.splice(0).forEach(function (c) { queue.push(c); });
    }, m.scrollMs + 1500);
  }

  // ---- connection
  var statusTimer = null;
  function setStatus(text, hideAfterMs) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.remove('hidden');
    if (hideAfterMs) statusTimer = setTimeout(function () { statusEl.classList.add('hidden'); }, hideAfterMs);
  }

  var attempt = 0;
  var reconnectTimer = null;
  function connect() {
    reconnectTimer = null;
    if (!channel) { setStatus('Add ?channel=yourname to this URL'); return; }
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + location.host + '/ws?channel=' + encodeURIComponent(channel));
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'hello') { attempt = 0; setStatus('Starring: Chat is connected', 4000); }
      else if (msg.type === 'cast') { if (creditsActive) { if (deferred.length < 20) deferred.push(msg); } else queue.push(msg); }
      else if (msg.type === 'credits') rollCredits(msg);
      else if (msg.type === 'uncast') {
        deferred = deferred.filter(function (c) { return !(msg.login && c.login === msg.login); });
        queue.removeWhere(function (c) { return !!msg.login && c.login === msg.login; });
      } else if (msg.type === 'episode') queue.reset();
    };
    ws.onclose = function () {
      if (reconnectTimer) return;
      setStatus('Starring: Chat is reconnecting');
      var delay = Math.min(10000, 500 * Math.pow(2, attempt));
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  }
  connect();
})();
