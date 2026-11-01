(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var channel = SetupCore.normalizeChannel(params.get('channel') || '');
  var password = '';
  var poll = null;
  var seq = 0;
  var refreshing = false;
  var pendingRefresh = false; // an action finished while a poll was in flight: refresh once more
  var lastSig = '';           // what is on screen, so a poll that changed nothing does not rebuild the table
  var connecting = false;
  var copyTimer = null;
  var loaded = false;      // false until the first cast arrives (drives the loading state)
  var connected = true;    // false while polling fails (drives the error state)
  var state = { episode: 1, paused: false, cast: [] };
  var twoStep = ControlCore.createTwoStep({ windowMs: 4000 });
  var creditsUntil = 0;
  var creditsTimer = null;
  var CREDITS_MS = 45000;
  var disarmTimer = null;

  // One timer drops any "tap again" prompt back to normal once its window has passed.
  function scheduleDisarm() {
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(function () { renderTiles(); renderCast(); }, 4100);
  }

  // ---- feedback ------------------------------------------------------------------------------------------
  var toastTimer = null;
  function toast(text, isErr) {
    var t = $('toast');
    t.textContent = text;
    t.classList.toggle('err', !!isErr);
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  // Every call carries the password in a header; the server checks it each time.
  function api(method, path, body) {
    return fetch('api/control/' + path, {
      method: method,
      headers: Object.assign({ 'x-control-password': password }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
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
    ['chanChip', 'stateChip', 'epChip'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('overlayUrl').textContent = '';
    if (message) { $('loginMsg').textContent = message; $('loginMsg').className = 'field-msg err'; $('pw').setAttribute('aria-invalid', 'true'); $('pw').focus({ preventScroll: true }); }
  }

  // ---- rendering --------------------------------------------------------------------------------------------
  function renderHeader() {
    $('chanChip').textContent = '#' + channel;
    $('chanChip').classList.remove('hidden');
    $('episode').textContent = String(state.episode);
    $('epChip').classList.remove('hidden');
    $('stateChip').classList.remove('hidden');
    $('stateText').textContent = state.paused ? 'Casting paused' : 'Casting on';
    $('casting').setAttribute('aria-checked', String(!state.paused));
    $('castingSub').textContent = state.paused ? 'Paused: new chatters are not getting roles. Switch it on to start again.' : 'On: new chatters get a role.';
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
    return c;
  }

  function memberRow(m) {
    var key = 'rm:' + m.login;
    var tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    [['nm', m.name], ['rl', m.role], ['ty', ControlCore.tierLabel(m.tier)]].forEach(function (c) {
      var td = cell('td', c[0], c[1]); td.setAttribute('role', 'cell'); tr.appendChild(td);
    });
    var td = cell('td', 'ac');
    td.setAttribute('role', 'cell');
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary';
    var armed = twoStep.isArmed(key);
    btn.textContent = armed ? 'Yes, remove' : 'Remove';
    btn.classList.toggle('armed', armed);
    btn.dataset.key = key;
    btn.setAttribute('aria-label', (armed ? 'Yes, remove ' : 'Remove ') + m.name + ' from tonight’s cast');
    btn.addEventListener('click', function () {
      if (twoStep.press(key) === 'confirmed') {
        act('uncast', { login: m.login }, m.name + ' removed from this episode.');
      } else {
        toast('Tap “Yes, remove” to take ' + m.name + ' out of tonight’s cast.');
        renderCast();
        scheduleDisarm();
      }
    });
    td.appendChild(btn);
    tr.appendChild(td);
    return tr;
  }

  function skeletonRows(body) {
    for (var i = 0; i < 4; i++) {
      var tr = document.createElement('tr'); tr.className = 'skeleton'; tr.setAttribute('role', 'row');
      ['9rem', '12rem', '7rem', '5rem'].forEach(function (w) {
        var td = document.createElement('td'); td.setAttribute('role', 'cell'); var s = document.createElement('span'); s.style.inlineSize = w; td.appendChild(s); tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  function renderCast() {
    var all = state.cast || [];
    if (all.length < 8 && $('filter').value) { $('filter').value = ''; syncFilterUrl(); } // never filter with a hidden box
    var typed = $('filter').value.trim();
    var q = typed.toLowerCase();
    var rows = ControlCore.flattenCast(all).filter(function (m) {
      return !q || (m.name + ' ' + m.role).toLowerCase().indexOf(q) !== -1;
    });
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
      var tr = document.createElement('tr'); tr.setAttribute('role', 'row'); var td = cell('td', 'rl', 'Nobody matches “' + typed + '”.'); td.setAttribute('role', 'cell'); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr);
    }
    if (focusKey) {
      var again = body.querySelector('button[data-key="' + focusKey.replace(/"/g, '') + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function render() { renderHeader(); renderTiles(); renderCast(); lastSig = signature(); }
  function signature() { return JSON.stringify([state.cast, state.paused, state.episode, connected, loaded, twoStep.isArmed('new-episode')]); }

  // ---- talking to the server -----------------------------------------------------------------------------------
  function refresh() {
    if (!password) return Promise.resolve();
    if (refreshing) { pendingRefresh = true; return Promise.resolve(); }
    refreshing = true;
    var mine = ++seq;
    return api('GET', 'cast?channel=' + encodeURIComponent(channel))
      .then(function (s) {
        connected = true; loaded = true;
        if (mine === seq && password) {
          state = s;
          // only rebuild the page when something changed, so a tap or keyboard focus is never lost to a poll
          if (signature() !== lastSig) render();
        }
      })
      .catch(function (e) {
        if (e.locked) return;
        if (connected) toast('Lost the connection to the server. Still trying.', true); // said once, when it drops
        connected = false; renderCast();   // keep the last cast on screen and say the data may be old
        lastSig = '';                      // so the next successful poll always redraws and clears the banner
      })
      .then(function () { refreshing = false; if (pendingRefresh) { pendingRefresh = false; refresh(); } });
  }

  function act(path, extra, okText) {
    return api('POST', path, Object.assign({ channel: channel }, extra || {}))
      .then(function (res) { if (okText) toast(okText); return res; })
      .then(function (res) { refresh(); return res; })
      .catch(function (e) { if (!e.locked) toast(e.message, true); });
  }

  // ---- credits countdown (a 2px meter is the only thing that moves) -----------------------------------------------
  function tickCredits() {
    var left = creditsUntil - Date.now();
    var tile = $('credits');
    if (left <= 0) {
      clearInterval(creditsTimer); creditsTimer = null;
      tile.setAttribute('aria-disabled', 'false');
      $('creditsTitle').textContent = 'Roll credits';
      $('creditsSub').textContent = 'End the episode with the credits (about 45 seconds).';
      $('creditsProg').style.transform = 'scaleX(0)';
      return;
    }
    tile.setAttribute('aria-disabled', 'true');
    $('creditsTitle').textContent = 'Credits rolling';
    $('creditsSub').textContent = ControlCore.countdownLabel(left) + ' left';
    $('creditsProg').style.transform = 'scaleX(' + (1 - left / CREDITS_MS).toFixed(3) + ')';
  }

  // ---- filter lives in the URL so a reload keeps it --------------------------------------------------------------
  function syncFilterUrl() {
    var next = location.pathname + ControlCore.withParam(location.search, 'q', $('filter').value.trim());
    history.replaceState(null, '', next);
  }

  // ---- connecting ------------------------------------------------------------------------------------------------
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
      $('overlayUrl').textContent = SetupCore.overlayUrl(location.origin, channel);
      render();
      $('casting').focus({ preventScroll: true }); // the login form just went away: put focus on the first control
      clearInterval(poll);
      poll = setInterval(refresh, 4000);
    }).catch(function (err) {
      if (password) { password = ''; msg.textContent = err.message; msg.className = 'field-msg err'; $('pw').setAttribute('aria-invalid', 'true'); $('pw').focus({ preventScroll: true }); }
    }).then(function () { connecting = false; $('connect').removeAttribute('aria-busy'); });
  }

  // ---- buttons -------------------------------------------------------------------------------------------------------
  $('loginForm').addEventListener('submit', connect);
  $('casting').addEventListener('click', function () {
    var pause = !state.paused;
    seq += 1; // an in-flight poll must not overwrite the new value with the old one
    state.paused = pause; renderHeader(); // respond instantly, the server confirms on the next refresh
    act(pause ? 'pause' : 'resume', null, pause ? 'Casting paused.' : 'Casting is on.').then(function (res) {
      if (!res) { state.paused = !pause; renderHeader(); } // the request failed: show the real state again
    });
  });
  $('credits').addEventListener('click', function () {
    if ($('credits').getAttribute('aria-disabled') === 'true') return;
    act('credits', null, null).then(function (res) {
      if (!res) return;
      if (res.rolled) {
        toast('Credits are rolling.');
        creditsUntil = Date.now() + CREDITS_MS;
        clearInterval(creditsTimer); creditsTimer = setInterval(tickCredits, 250); tickCredits();
      } else {
        toast({ busy: 'Credits are already rolling.', empty: 'Nobody has been cast yet, so there is nothing to roll.', 'no-overlay': 'No overlay is open for this channel. Add the link in OBS first.' }[res.reason] || 'Could not roll the credits.', true);
      }
    });
  });
  $('newEpisode').addEventListener('click', function () {
    if (twoStep.press('new-episode') === 'confirmed') {
      renderTiles();
      act('new-episode', null, 'New episode started.');
    } else {
      renderTiles();
      scheduleDisarm();
    }
  });
  $('testCard').addEventListener('click', function () {
    act('test-card', null, null).then(function (res) {
      if (!res) return;
      if (res.delivered > 0) toast('Test card sent.');
      else toast('Sent, but no overlay is open. Add the link in OBS first.', true);
    });
  });
  $('filter').addEventListener('input', function () { syncFilterUrl(); renderCast(); });
  $('retry').addEventListener('click', function () { refresh(); });
  $('copyOverlay').addEventListener('click', function () {
    var btn = $('copyOverlay');
    SetupCore.copyToClipboard($('overlayUrl').textContent).then(function (ok) {
      btn.textContent = ok ? 'Copied' : 'Select the link and copy it';
      btn.classList.toggle('done', ok);
      toast(ok ? 'Link copied.' : 'Could not copy. Select the link and copy it by hand.', !ok);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { btn.textContent = 'Copy link'; btn.classList.remove('done'); }, 3000);
    });
  });

  $('chan').value = channel;
  $('filter').value = params.get('q') || '';
  (channel ? $('pw') : $('chan')).focus({ preventScroll: true });
})();
