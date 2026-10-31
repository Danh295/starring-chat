// OBS browser source. Connects to the server and shows role cards one at a time.
(function () {
  var params = new URLSearchParams(location.search);
  var channel = (params.get('channel') || '').toLowerCase();
  var stage = document.getElementById('stage');
  var statusEl = document.getElementById('status');
  var clapperTpl = document.getElementById('clapper-tpl');
  var CLAP_MS = 1500;   // clapperboard "casting..." before the reveal
  var HOLD_MS = 7000;   // card stays on screen
  var EXIT_MS = 650;
  var STING_VOLUME = 0.4;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // never innerHTML: chat text is untrusted
    return e;
  }

  // ---- optional hand-drawn art: drop PNGs into public/art/ and they are used automatically
  function probeArt(file, bodyClass, cssVar) {
    var img = new Image();
    img.onload = function () {
      document.body.classList.add(bodyClass);
      document.documentElement.style.setProperty(cssVar, 'url("art/' + file + '")');
    };
    img.src = 'art/' + file;
  }
  probeArt('card-frame.png', 'has-frame-art', '--frame-art');
  probeArt('stamp.png', 'has-stamp-art', '--stamp-art');
  probeArt('background.png', 'has-bg-art', '--bg-art');

  // ---- sound: public/audio/sting.mp3 if present, otherwise a short synthesized sting
  var audioCtx = null;
  var hasFileSting = null; // null = unknown, true/false after the first try
  function synthSting() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = audioCtx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
        g.gain.exponentialRampToValueAtTime(STING_VOLUME * 0.6, t0 + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.5);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.55);
      });
    } catch (_) { /* audio is optional */ }
  }
  function playSting() {
    if (hasFileSting === false) return synthSting();
    var a = new Audio('audio/sting.mp3');
    a.volume = STING_VOLUME;
    a.addEventListener('error', function () { hasFileSting = false; synthSting(); });
    a.addEventListener('canplaythrough', function () { hasFileSting = true; });
    var p = a.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked: stay silent */ });
  }

  // ---- cards
  var nodes = new Map(); // card -> DOM node
  var queue = OverlayCore.createCardQueue({
    show: function (c) {
      var m = OverlayCore.cardModel(c);
      var node = el('div', 'card casting ' + m.className);
      try {
        node.appendChild(clapperTpl.content.cloneNode(true));
        var body = el('div', 'body');
        body.appendChild(el('div', 'label', m.label));
        if (m.badge) body.appendChild(el('div', 'badge', m.badge));
        body.appendChild(el('div', 'who', m.who));
        body.appendChild(el('div', 'role', m.role));
        body.appendChild(el('div', 'logline', m.logline));
        body.appendChild(el('div', 'stamp'));
        node.appendChild(body);
        stage.appendChild(node);
      } catch (err) { node.remove(); throw err; }
      nodes.set(c, node);
      requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add('in'); }); });
      setTimeout(function () {
        if (!node.isConnected) return;
        node.classList.remove('casting');
        playSting();
      }, CLAP_MS);
    },
    wait: function (_c, skipped) { return Promise.race([sleep(CLAP_MS + HOLD_MS), skipped]); },
    hide: function (c) {
      var node = nodes.get(c);
      nodes.delete(c);
      if (!node) return undefined;
      node.classList.remove('in');
      return sleep(EXIT_MS).then(function () { node.remove(); });
    },
  });

  // ---- connection
  var statusTimer = null;
  function setStatus(text, hide, autoHideMs) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle('hidden', !!hide);
    if (autoHideMs) statusTimer = setTimeout(function () { statusEl.classList.add('hidden'); }, autoHideMs);
  }

  var attempt = 0;
  var reconnectTimer = null;
  function connect() {
    reconnectTimer = null;
    if (!channel) { setStatus('Add ?channel=yourname to this URL', false); return; }
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + location.host + '/ws?channel=' + encodeURIComponent(channel));
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'hello') { attempt = 0; setStatus('Starring: Chat is connected', false, 4000); }
      else if (msg.type === 'cast') queue.push(msg);
      else if (msg.type === 'uncast') queue.removeWhere(function (c) { return c.login === msg.login; });
      else if (msg.type === 'episode') queue.clear();
    };
    ws.onclose = function () {
      if (reconnectTimer) return;
      setStatus('Starring: Chat reconnecting...', false);
      var delay = Math.min(10000, 500 * Math.pow(2, attempt));
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  }
  connect();
})();
