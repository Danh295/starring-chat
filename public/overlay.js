// OBS browser source. Connects to the server, shows role cards one at a time.
(function () {
  var params = new URLSearchParams(location.search);
  var channel = (params.get('channel') || '').toLowerCase();
  var stage = document.getElementById('stage');
  var statusEl = document.getElementById('status');
  var HOLD_MS = 7000;
  var EXIT_MS = 600;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // never innerHTML: chat text is untrusted
    return e;
  }

  var nodes = new Map(); // card -> DOM node (kept out of the message object)
  var str = function (v, fallback) { return typeof v === 'string' && v ? v : fallback; };

  var queue = OverlayCore.createCardQueue({
    show: function (c) {
      var node = el('div', 'card ' + str(c.kind, 'cast'));
      try {
        node.appendChild(el('div', 'who', '@' + str(c.user, 'someone') + ' as'));
        node.appendChild(el('div', 'role', str(c.role, 'The Mystery Guest')));
        node.appendChild(el('div', 'logline', str(c.logline, '')));
        stage.appendChild(node);
      } catch (err) { node.remove(); throw err; }
      nodes.set(c, node);
      requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add('in'); }); });
    },
    wait: function () { return sleep(HOLD_MS); },
    hide: function (c) {
      var node = nodes.get(c);
      nodes.delete(c);
      if (!node) return undefined;
      node.classList.remove('in');
      return sleep(EXIT_MS).then(function () { node.remove(); });
    },
  });

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
