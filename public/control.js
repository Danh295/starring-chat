// The control room: log in with the control password, then run the show. Every request carries the password.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var channel = SetupCore.normalizeChannel(params.get('channel') || '');
  var password = '';
  var poll = null;
  var seq = 0;                  // ignore answers that arrive out of order
  var refreshing = false;
  var pendingRefresh = false;   // an action finished while a poll was in flight: poll once more
  var loaded = false;           // false until the first cast arrives (the loading state)
  var connected = true;         // false while polling fails (the error state)
  var connecting = false;
  var state = { episode: 1, paused: false, cast: [] };
  var lastSig = '';             // what is on screen, so a poll that changed nothing does not rebuild it
  var twoStep = ControlCore.createTwoStep({ windowMs: 4000 });
  var disarmTimer = null;
  var creditsUntil = 0;
  var creditsTimer = null;
  var copyTimer = null;
  var CREDITS_MS = 45000;

  // ---- the one status line: the result of the last action, next to the controls that caused it
  function say(text, isErr) {
    var s = $('status');
    s.textContent = text;
    s.classList.toggle('err', !!isErr);
  }

  // ---- talking to the server
  function api(method, path, body) {
    return fetch('api/control/' + path, {
      method: method,
      headers: Object.assign({ 'x-control-password': password }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).catch(function () { throw new Error('Can’t reach Starring: Chat. Check that it is running.'); }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        var locked = function (message) { lock(message); var err = new Error(message); err.locked = true; return err; };
        if (res.status === 401) throw locked('That password is not right. Check CONTROL_PASSWORD on the server.');
        if (res.status === 429) throw locked('Too many wrong passwords. Wait a minute and try again.');
        if (res.status === 503) throw locked('The control room is switched off. Set CONTROL_PASSWORD on the server and restart it.');
        if (res.status === 404) throw new Error('This server is not running Starring: Chat for #' + channel + '.');
        if (!res.ok) throw new Error(data.error || ('Something went wrong (' + res.status + ').'));
        return data;
      });
    });
  }

  function lock(message) {
    clearInterval(poll); poll = null; password = ''; seq += 1; loaded = false; connected = true; pendingRefresh = false; lastSig = '';
    twoStep.reset();
    clearTimeout(disarmTimer); clearInterval(creditsTimer); creditsTimer = null; creditsUntil = 0;
    $('filter').value = '';
    $('panel').classList.add('hidden');
    $('login').classList.remove('hidden');
    ['chanFact', 'stateFact', 'epFact'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('overlayUrl').value = '';
    if (message) {
      $('loginMsg').textContent = message; $('loginMsg').className = 'field-msg err';
      $('pw').setAttribute('aria-invalid', 'true'); $('pw').focus({ preventScroll: true });
    }
  }

  // ---- drawing
  function renderHeader() {
    $('chanFact').textContent = '#' + channel;
    $('chanFact').classList.remove('hidden');
    $('episode').textContent = String(state.episode);
    $('epFact').classList.remove('hidden');
    var st = $('stateFact');
    st.classList.remove('hidden');
    st.textContent = state.paused ? 'Casting paused' : 'Casting on';
    st.className = state.paused ? '' : 'live';
    $('casting-on').checked = !state.paused;
    $('casting-off').checked = state.paused;
    $('castingSub').textContent = state.paused ? 'Paused: new chatters are not getting roles. Choose On to start again.' : 'On: new chatters get a role.';
  }

  function renderTiles() {
    var armed = twoStep.isArmed('new-episode');
    $('newEpisode').classList.toggle('armed', armed);
    $('newTitle').textContent = armed ? 'Tap again to confirm' : 'New episode';
    $('newSub').textContent = armed ? 'This clears tonight’s cast.' : 'Clear tonight’s cast and start fresh.';
  }

  function cell(tag, cls, text) {
    var c = document.createElement(tag);
    if (cls) c.className = cls;
    if (text !== undefined) c.textContent = text;
    c.setAttribute('role', tag === 'tr' ? 'row' : 'cell');
    return c;
  }

  function memberRow(m) {
    var key = 'rm:' + m.login;
    var tr = cell('tr');
    var who = cell('td');
    var box = document.createElement('div'); box.className = 'who';
    var mark = document.createElement('span'); mark.className = 'mark tier-' + m.tier; mark.textContent = OverlayCore.initialOf(m.name);
    box.appendChild(mark);
    box.appendChild(document.createTextNode(m.name));
    who.appendChild(box);
    tr.appendChild(who);
    var roleCell = cell('td', 'role', m.role); roleCell.dataset.label = 'Role';
    var typeCell = cell('td', 'type', ControlCore.tierLabel(m.tier)); typeCell.dataset.label = 'Type';
    tr.appendChild(roleCell);
    tr.appendChild(typeCell);
    var act = cell('td', 'act');
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary';
    var armed = twoStep.isArmed(key);
    btn.textContent = armed ? 'Yes, remove' : 'Remove';
    btn.classList.toggle('armed', armed);
    btn.dataset.key = key;
    btn.setAttribute('aria-label', (armed ? 'Yes, remove ' : 'Remove ') + m.name + ' from tonight’s cast');
    btn.addEventListener('click', function () {
      if (twoStep.press(key) === 'confirmed') {
        act2('uncast', { login: m.login }, m.name + ' removed from this episode.');
      } else {
        say('Tap “Yes, remove” to take ' + m.name + ' out of tonight’s cast.');
        renderCast();
        scheduleDisarm();
      }
    });
    act.appendChild(btn);
    tr.appendChild(act);
    return tr;
  }

  function skeletonRows(body) {
    for (var i = 0; i < 4; i++) {
      var tr = cell('tr'); tr.className = 'skeleton';
      ['9rem', '12rem', '7rem'].forEach(function (w) {
        var td = cell('td'); var s = document.createElement('span'); s.style.inlineSize = w; td.appendChild(s); tr.appendChild(td);
      });
      tr.appendChild(cell('td'));
      body.appendChild(tr);
    }
  }

  function renderCast() {
    var all = state.cast || [];
    if (all.length < 8 && $('filter').value) { $('filter').value = ''; syncFilterUrl(); } // never filter with a hidden box
    var typed = $('filter').value.trim();
    var q = typed.toLowerCase();
    var rows = ControlCore.flattenCast(all).filter(function (m) { return !q || (m.name + ' ' + m.role).toLowerCase().indexOf(q) !== -1; });
    var body = $('cast');
    var focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null; // keep keyboard focus across a rebuild
    while (body.firstChild) body.removeChild(body.firstChild);

    var showLoading = !loaded;
    var showEmpty = loaded && all.length === 0;
    $('castTitle').textContent = all.length ? 'Tonight’s cast (' + all.length + ')' : 'Tonight’s cast';
    $('filter').classList.toggle('hidden', all.length < 8);
    $('castTable').classList.toggle('hidden', !showLoading && all.length === 0);
    $('castTable').setAttribute('aria-busy', String(showLoading));
    $('empty').classList.toggle('hidden', !showEmpty);
    $('connError').classList.toggle('hidden', connected);

    if (showLoading) { skeletonRows(body); return; }
    rows.forEach(function (m) { body.appendChild(memberRow(m)); });
    if (all.length && !rows.length) {
      var tr = cell('tr', 'empty-row'); var td = cell('td', '', 'Nobody matches “' + typed + '”.'); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr);
    }
    if (focusKey) {
      var again = body.querySelector('button[data-key="' + focusKey.replace(/"/g, '') + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function signature() { return JSON.stringify([state.cast, state.paused, state.episode, connected, loaded]); }
  function render() { renderHeader(); renderTiles(); renderCast(); lastSig = signature(); }

  // One timer drops any "tap again" prompt back to normal once its window has passed.
  function scheduleDisarm() {
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(function () { renderTiles(); renderCast(); }, 4100);
  }

  function stamp() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    $('updated').textContent = 'Updated ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '. This page checks every 4 seconds.';
  }

  // ---- polling and actions
  function refresh() {
    if (!password) return Promise.resolve();
    if (refreshing) { pendingRefresh = true; return Promise.resolve(); }
    refreshing = true;
    var mine = ++seq;
    return api('GET', 'cast?channel=' + encodeURIComponent(channel))
      .then(function (s) {
        connected = true; loaded = true;
        if (mine === seq && password) {
          state = s; stamp();
          if (signature() !== lastSig) render(); // a poll that changed nothing never rebuilds the table
        }
      })
      .catch(function (e) {
        if (e.locked) return;
        if (connected) say('Lost the connection to the server. Still trying.', true);
        connected = false; renderCast();
        lastSig = ''; // so the next good poll always redraws and clears the notice
      })
      .then(function () { refreshing = false; if (pendingRefresh) { pendingRefresh = false; refresh(); } });
  }

  function act2(path, extra, okText) {
    return api('POST', path, Object.assign({ channel: channel }, extra || {}))
      .then(function (res) { if (okText) say(okText); return res; })
      .then(function (res) { refresh(); return res; })
      .catch(function (e) { if (!e.locked) say(e.message, true); });
  }

  // The 3px meter is the only thing that moves while the credits roll.
  function tickCredits() {
    var left = creditsUntil - Date.now();
    var btn = $('credits');
    if (left <= 0) {
      clearInterval(creditsTimer); creditsTimer = null;
      btn.setAttribute('aria-disabled', 'false');
      $('creditsTitle').textContent = 'Roll credits';
      $('creditsSub').textContent = 'End the episode with the credits (about 45 seconds).';
      $('creditsProg').style.transform = 'scaleX(0)';
      return;
    }
    btn.setAttribute('aria-disabled', 'true');
    $('creditsTitle').textContent = 'Credits rolling';
    $('creditsSub').textContent = ControlCore.countdownLabel(left) + ' left.';
    $('creditsProg').style.transform = 'scaleX(' + (1 - left / CREDITS_MS).toFixed(3) + ')';
  }

  // The filter lives in the URL, so a reload keeps it.
  function syncFilterUrl() {
    history.replaceState(null, '', location.pathname + ControlCore.withParam(location.search, 'q', $('filter').value.trim()));
  }

  // ---- logging in
  function connect(e) {
    if (e) e.preventDefault();
    if (connecting) return;
    var msg = $('loginMsg');
    channel = SetupCore.normalizeChannel($('chan').value);
    if (!channel) { msg.textContent = 'Enter your channel name, like pixelbean.'; msg.className = 'field-msg err'; return; }
    if (!$('pw').value) { msg.textContent = 'Enter the control password.'; msg.className = 'field-msg err'; return; }
    password = $('pw').value;
    $('pw').value = '';
    $('pw').removeAttribute('aria-invalid');
    msg.textContent = 'Connecting...'; msg.className = 'field-msg';
    connecting = true;
    $('connect').setAttribute('aria-busy', 'true');
    api('GET', 'cast?channel=' + encodeURIComponent(channel)).then(function (s) {
      state = s; loaded = true; connected = true;
      msg.textContent = '';
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
      $('overlayUrl').value = SetupCore.overlayUrl(location.origin, channel);
      say('Ready.');
      stamp();
      render();
      $('casting-on').focus({ preventScroll: true }); // the login form just went away: put focus on the first control
      clearInterval(poll);
      poll = setInterval(refresh, 4000);
    }).catch(function (err) {
      if (password) { password = ''; msg.textContent = err.message; msg.className = 'field-msg err'; $('pw').setAttribute('aria-invalid', 'true'); $('pw').focus({ preventScroll: true }); }
    }).then(function () { connecting = false; $('connect').removeAttribute('aria-busy'); });
  }

  // ---- wiring
  $('loginForm').addEventListener('submit', connect);
  document.querySelectorAll('input[name="casting"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var pause = r.value === 'off';
      if (pause === state.paused) return;
      seq += 1; // an in-flight poll must not overwrite the new choice with the old one
      state.paused = pause; renderHeader(); // answer at once; the server confirms on the next poll
      act2(pause ? 'pause' : 'resume', null, pause ? 'Casting paused.' : 'Casting is on.').then(function (res) {
        if (!res) { state.paused = !pause; renderHeader(); } // the request failed: show the real state again
      });
    });
  });
  var creditsPending = false;
  $('credits').addEventListener('click', function () {
    if ($('credits').getAttribute('aria-disabled') === 'true') { say('Credits are already rolling.'); return; }
    if (creditsPending) return;
    creditsPending = true;
    act2('credits', null, null).then(function (res) {
      creditsPending = false;
      if (!res) return;
      if (res.rolled) {
        say('Credits are rolling.');
        creditsUntil = Date.now() + CREDITS_MS;
        clearInterval(creditsTimer); creditsTimer = setInterval(tickCredits, 250); tickCredits();
      } else {
        say({ busy: 'Credits are already rolling.', empty: 'Nobody has been cast yet, so there is nothing to roll.', 'no-overlay': 'No overlay is open for this channel. Add the link in OBS first.' }[res.reason] || 'Could not roll the credits.', true);
      }
    });
  });
  $('newEpisode').addEventListener('click', function () {
    if (twoStep.press('new-episode') === 'confirmed') {
      renderTiles();
      act2('new-episode', null, 'New episode started.');
    } else {
      say('Tap New episode again within 4 seconds to clear tonight’s cast and start fresh.');
      renderTiles();
      scheduleDisarm();
    }
  });
  $('testCard').addEventListener('click', function () {
    act2('test-card', null, null).then(function (res) {
      if (!res) return;
      if (res.delivered > 0) say('Test card sent.');
      else say('Sent, but no overlay is open. Add the link in OBS first.', true);
    });
  });
  $('filter').addEventListener('input', function () { syncFilterUrl(); renderCast(); });
  $('retry').addEventListener('click', function () { refresh(); });
  $('copyOverlay').addEventListener('click', function () {
    var btn = $('copyOverlay');
    SetupCore.copyToClipboard($('overlayUrl').value).then(function (ok) {
      btn.textContent = ok ? 'Copied' : 'Select the link and copy it';
      btn.classList.toggle('done', ok);
      say(ok ? 'Link copied.' : 'Could not copy. Select the link and copy it by hand.', !ok);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { btn.textContent = 'Copy link'; btn.classList.remove('done'); }, 3000);
    });
  });

  if (location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) === -1) $('httpWarn').classList.remove('hidden');
  $('chan').value = channel;
  $('filter').value = params.get('q') || '';
  (channel ? $('pw') : $('chan')).focus({ preventScroll: true });
})();
