(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var channel = SetupCore.normalizeChannel(params.get('channel') || '');
  var password = '';
  var poll = null;

  function say(text, ok) { var m = $('msg'); m.textContent = text; m.className = 'status ' + (ok ? 'ok' : (text ? 'err' : '')); }

  // Every call carries the password in a header; the server checks it each time.
  function api(method, path, body) {
    return fetch('api/control/' + path, {
      method: method,
      headers: Object.assign({ 'x-control-password': password }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { lock(); throw new Error('Wrong password.'); }
        if (res.status === 429 || res.status === 503) { lock(); throw new Error(data.error || 'Control is unavailable right now.'); }
        if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }

  function lock() {
    clearInterval(poll); poll = null; password = ''; seq += 1;
    $('panel').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('epPill').classList.add('hidden');
    $('pausedPill').classList.add('hidden');
    $('userbar').classList.remove('online');
    $('userName').textContent = 'Not connected';
    $('userState').textContent = 'Enter your password';
    $('userAv').textContent = '?';
    $('overlayUrl').textContent = '';
    $('copiedOverlay').textContent = '';
    while ($('cast').firstChild) $('cast').removeChild($('cast').firstChild);
    $('empty').textContent = 'Connect to see tonight\'s cast.';
    $('empty').classList.remove('hidden');
  }

  var GROUPS = [['cast', 'Starring'], ['guest', 'Special guest stars'], ['lurk', 'Background extras']];

  function memberRow(m) {
    var row = document.createElement('div');
    row.className = 'member ' + (m.kind || 'cast');
    row.style.setProperty('--c', OverlayCore.nameColor(m.name));
    var av = document.createElement('div'); av.className = 'av'; av.textContent = OverlayCore.initialOf(m.name);
    var tx = document.createElement('div'); tx.className = 'tx';
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.name;
    if (m.regular) { var st = document.createElement('span'); st.className = 'st'; st.textContent = '\u2605'; nm.appendChild(st); }
    var rl = document.createElement('span'); rl.className = 'rl'; rl.textContent = m.role;
    tx.appendChild(nm); tx.appendChild(rl);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary'; btn.textContent = 'Uncast';
    btn.setAttribute('aria-label', 'Uncast ' + m.name);
    btn.addEventListener('click', function () { act('uncast', { login: m.login }, 'Removed ' + m.name + ' for this episode.'); });
    row.appendChild(av); row.appendChild(tx); row.appendChild(btn);
    return row;
  }

  function render(state) {
    $('episode').textContent = String(state.episode);
    $('epPill').classList.remove('hidden');
    $('pausedPill').classList.toggle('hidden', !state.paused);
    $('userbar').classList.add('online');
    $('userName').textContent = channel;
    $('userAv').textContent = OverlayCore.initialOf(channel);
    $('userState').textContent = state.paused ? 'Casting paused' : 'Casting live';
    var list = $('cast');
    while (list.firstChild) list.removeChild(list.firstChild);
    var cast = state.cast || [];
    GROUPS.forEach(function (g) {
      var members = cast.filter(function (m) { return (m.kind || 'cast') === g[0]; });
      if (!members.length) return;
      var h = document.createElement('h4'); h.textContent = g[1] + ' (' + members.length + ')';
      list.appendChild(h);
      members.forEach(function (m) { list.appendChild(memberRow(m)); });
    });
    $('empty').textContent = 'Nobody has been cast yet. The first chatter will show up here.';
    $('empty').classList.toggle('hidden', cast.length > 0);
  }

  var seq = 0;          // ignore responses that arrive out of order
  var refreshing = false;
  function refresh() {
    if (refreshing || !password) return Promise.resolve();
    refreshing = true;
    var mine = ++seq;
    return api('GET', 'cast?channel=' + encodeURIComponent(channel))
      .then(function (state) { if (mine === seq && password) render(state); })
      .catch(function (e) { say(e.message); })
      .then(function () { refreshing = false; });
  }

  function act(path, extra, okText) {
    var body = Object.assign({ channel: channel }, extra || {});
    return api('POST', path, body).then(function (res) {
      if (path === 'credits' && res.rolled === false) {
        say(res.reason === 'busy' ? 'Credits are already rolling.' : res.reason === 'empty' ? 'Nobody is in the cast yet.' : res.reason === 'no-overlay' ? 'No overlay is connected for this channel.' : 'Could not roll credits.');
      } else if (path === 'test-card' && res.delivered === 0) {
        say('No overlay is connected for this channel.');
      } else say(okText, true);
      return refresh();
    }).catch(function (e) { say(e.message); });
  }

  function connect() {
    channel = SetupCore.normalizeChannel($('chan').value);
    if (!channel) { say('Enter a valid channel name.'); return; }
    password = $('pw').value;
    $('pw').value = '';
    if (!password) { say('Enter the control password.'); return; }
    say('Connecting...', true);
    api('GET', 'cast?channel=' + encodeURIComponent(channel)).then(function (state) {
      say('Connected.', true);
      $('overlayUrl').textContent = SetupCore.overlayUrl(location.origin, channel);
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
      render(state);
      clearInterval(poll);
      poll = setInterval(refresh, 4000);
    }).catch(function (e) { say(e.message); });
  }

  $('copyOverlay').addEventListener('click', function () {
    SetupCore.copyToClipboard($('overlayUrl').textContent).then(function (ok) {
      $('copiedOverlay').textContent = ok ? 'Copied!' : 'Could not copy. Select the URL and copy it by hand.';
      setTimeout(function () { $('copiedOverlay').textContent = ''; }, 3500);
    });
  });
  $('chan').value = channel;
  $('connect').addEventListener('click', connect);
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') connect(); });
  $('testCard').addEventListener('click', function () { act('test-card', null, 'Sent a test card.'); });
  $('credits').addEventListener('click', function () { act('credits', null, 'Rolling credits.'); });
  $('pause').addEventListener('click', function () { act('pause', null, 'Casting paused.'); });
  $('resume').addEventListener('click', function () { act('resume', null, 'Casting resumed.'); });
  $('newEpisode').addEventListener('click', function () {
    if (window.confirm('Start a new episode? Tonight\'s cast will be cleared.')) act('new-episode', null, 'New episode started.');
  });
})();
