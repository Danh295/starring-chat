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

  // ---- optional hand-drawn art: drop PNGs into public/art/ and they are used automatically.
  // The server lists which files exist, so a default install makes no failing requests.
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

  // ---- sound: public/audio/sting.mp3 if present, otherwise a short synthesized sting
  var audioCtx = null;
  var hasFileSting = null; // null = still finding out
  var stingAudio = new Audio('audio/sting.mp3');
  stingAudio.preload = 'auto';
  stingAudio.volume = STING_VOLUME;
  stingAudio.addEventListener('error', function () { hasFileSting = false; });
  stingAudio.addEventListener('canplaythrough', function () { hasFileSting = true; });
  function synthSting() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
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
    if (hasFileSting !== true) return synthSting();
    stingAudio.currentTime = 0;
    var p = stingAudio.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked: stay silent */ });
  }

  // ---- cards
  var nodes = new Map(); // card -> DOM node
  var timers = new Map(); // card -> pending reveal timer
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
      timers.set(c, setTimeout(function () {
        if (!nodes.has(c)) return; // removed before the reveal: no sting, no flash
        node.classList.remove('casting');
        playSting();
      }, CLAP_MS));
    },
    wait: function (_c, skipped) {
      return new Promise(function (resolve) {
        var t = setTimeout(resolve, CLAP_MS + HOLD_MS);
        skipped.then(function () { clearTimeout(t); resolve(); });
      });
    },
    hide: function (c) {
      var node = nodes.get(c);
      nodes.delete(c);
      clearTimeout(timers.get(c));
      timers.delete(c);
      if (!node) return undefined;
      node.classList.remove('in');
      return sleep(EXIT_MS).then(function () { node.remove(); });
    },
  });

  // ---- end credits
  var creditsEl = document.getElementById('credits');
  var creditsActive = false;
  var themeAudio = new Audio('audio/theme.mp3');
  themeAudio.preload = 'auto';
  themeAudio.volume = STING_VOLUME;
  var hasFileTheme = null;
  themeAudio.addEventListener('error', function () { hasFileTheme = false; });
  themeAudio.addEventListener('canplaythrough', function () { hasFileTheme = true; });

  // Placeholder theme (a bouncy synthesized loop) used until public/audio/theme.mp3 exists.
  function synthTheme(ms) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var melody = [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 72];
      var step = 0.22;
      var t0 = audioCtx.currentTime + 0.1;
      var total = ms / 1000;
      var master = audioCtx.createGain();
      master.gain.setValueAtTime(STING_VOLUME * 0.5, t0);
      master.gain.setValueAtTime(STING_VOLUME * 0.5, t0 + total - 3);
      master.gain.linearRampToValueAtTime(0.0001, t0 + total);
      master.connect(audioCtx.destination);
      for (var i = 0; i * step < total - 0.3; i++) {
        var note = function (midi, when, len, type, vol) {
          var o = audioCtx.createOscillator(); var g = audioCtx.createGain();
          o.type = type; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
          g.gain.setValueAtTime(0.0001, when);
          g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, when + len);
          o.connect(g); g.connect(master); o.start(when); o.stop(when + len + 0.05);
        };
        note(melody[i % melody.length], t0 + i * step, 0.3, 'triangle', 0.5);
        if (i % 4 === 0) note(melody[i % melody.length] - 24, t0 + i * step, 0.8, 'sine', 0.6);
      }
    } catch (_) { /* audio is optional */ }
  }
  function playTheme(ms) {
    if (hasFileTheme === true) {
      themeAudio.currentTime = 0;
      var p = themeAudio.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: stay silent */ });
      setTimeout(function () { themeAudio.pause(); }, ms);
    } else synthTheme(ms);
  }

  function section(parent, heading, list, small) {
    if (!list.length) return;
    parent.appendChild(el('div', 'head', heading));
    var box = el('div', small ? 'small' : '');
    list.forEach(function (p) {
      var line = el('div', 'line' + (p.regular ? ' regular' : ''));
      line.appendChild(el('span', 'name', p.user));
      line.appendChild(el('span', 'as', 'as'));
      line.appendChild(el('span', 'role', p.role));
      box.appendChild(line);
    });
    parent.appendChild(box);
  }

  function rollCredits(msg) {
    if (creditsActive) return;
    var m = OverlayCore.creditsModel(msg);
    creditsActive = true;
    queue.reset();
    while (creditsEl.firstChild) creditsEl.removeChild(creditsEl.firstChild);
    creditsEl.className = m.compact ? 'compact' : '';
    var scroll = el('div', 'scroll');
    scroll.style.setProperty('--dur', m.scrollMs + 'ms');
    scroll.style.animationDuration = m.scrollMs + 'ms';
    scroll.appendChild(el('div', 'ep', m.title));
    section(scroll, 'STARRING', m.starring, false);
    section(scroll, 'SPECIAL GUEST STARS', m.guests, false);
    section(scroll, 'BACKGROUND EXTRAS', m.extras, true);
    if (m.directedBy) {
      scroll.appendChild(el('div', 'head', 'DIRECTED BY'));
      scroll.appendChild(el('div', 'fin', m.directedBy));
    }
    scroll.appendChild(el('div', 'logo', 'Casting by ' + m.castingBy));
    creditsEl.appendChild(scroll);
    requestAnimationFrame(function () { creditsEl.classList.add('on'); });
    playTheme(m.scrollMs);
    setTimeout(function () { creditsEl.classList.remove('on'); }, m.scrollMs + 600);
    setTimeout(function () {
      while (creditsEl.firstChild) creditsEl.removeChild(creditsEl.firstChild);
      creditsActive = false;
    }, m.scrollMs + 2200);
  }

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
      if (msg.type === 'hello') { attempt = 0; setStatus('Starring: Chat is connected', false, 4000); loadArt(); }
      else if (msg.type === 'cast') { if (!creditsActive) queue.push(msg); }
      else if (msg.type === 'credits') rollCredits(msg);
      else if (msg.type === 'uncast') queue.removeWhere(function (c) { return !!msg.login && c.login === msg.login; });
      else if (msg.type === 'episode') queue.reset();
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
