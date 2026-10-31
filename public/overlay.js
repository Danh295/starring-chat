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

  var queue = OverlayCore.createCardQueue({
    show: function (c) {
      var node = el('div', 'card ' + (c.kind || 'cast'));
      node.appendChild(el('div', 'who', '@' + c.user + ' as'));
      node.appendChild(el('div', 'role', c.role));
      node.appendChild(el('div', 'logline', c.logline));
      stage.appendChild(node);
      c._node = node;
      requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add('in'); }); });
    },
    wait: function () { return sleep(HOLD_MS); },
    hide: function (c) {
      c._node.classList.remove('in');
      return sleep(EXIT_MS).then(function () { c._node.remove(); });
    },
  });

  function setStatus(text, hide) {
    statusEl.textContent = text;
    statusEl.classList.toggle('hidden', !!hide);
  }

  var attempt = 0;
  function connect() {
    if (!channel) { setStatus('Add ?channel=yourname to this URL'); return; }
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + location.host + '/ws?channel=' + encodeURIComponent(channel));
    ws.onopen = function () { attempt = 0; };
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'hello') { setStatus('Starring: Chat is connected', false); setTimeout(function () { setStatus('', true); }, 4000); }
      else if (msg.type === 'cast') queue.push(msg);
    };
    ws.onclose = function () {
      setStatus('Starring: Chat reconnecting...', false);
      attempt += 1;
      setTimeout(connect, Math.min(10000, 500 * Math.pow(2, attempt)));
    };
    ws.onerror = function () { ws.close(); };
  }
  connect();
})();
