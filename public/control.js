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
  }

  function render(state) {
    $('episode').textContent = String(state.episode);
    $('pausedPill').classList.toggle('hidden', !state.paused);
    var list = $('cast');
    while (list.firstChild) list.removeChild(list.firstChild);
    (state.cast || []).forEach(function (m) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var who = document.createElement('span'); who.className = 'who'; who.textContent = m.name;
      var as = document.createTextNode(' as ');
      var role = document.createElement('span'); role.className = 'role'; role.textContent = m.role;
      left.appendChild(who); left.appendChild(as); left.appendChild(role);
      var tag = document.createElement('span'); tag.className = 'tag';
      tag.textContent = m.kind === 'guest' ? ' GUEST STAR' : m.kind === 'lurk' ? ' EXTRA' : (m.regular ? ' REGULAR' : '');
      left.appendChild(tag);
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary'; btn.textContent = 'Uncast';
      btn.addEventListener('click', function () { act('uncast', { login: m.login }, 'Removed ' + m.name + ' for this episode.'); });
      li.appendChild(left); li.appendChild(btn);
      list.appendChild(li);
    });
    $('empty').classList.toggle('hidden', (state.cast || []).length > 0);
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
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
      render(state);
      clearInterval(poll);
      poll = setInterval(refresh, 4000);
    }).catch(function (e) { say(e.message); });
  }

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
