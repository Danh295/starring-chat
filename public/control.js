(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var channel = SetupCore.normalizeChannel(params.get('channel') || '');
  var password = '';
  var poll = null;
  var seq = 0;
  var refreshing = false;
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
    clearInterval(poll); poll = null; password = ''; seq += 1;
    twoStep.reset();
    clearTimeout(disarmTimer); clearInterval(creditsTimer); creditsTimer = null; creditsUntil = 0;
    $('filter').value = '';
    $('panel').classList.add('hidden');
    $('login').classList.remove('hidden');
    ['chanChip', 'stateChip', 'epChip'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('overlayUrl').textContent = '';
    if (message) { $('loginMsg').textContent = message; $('loginMsg').className = 'field-msg err'; }
  }

  // ---- rendering --------------------------------------------------------------------------------------------
  function renderHeader() {
    $('chanChip').textContent = '#' + channel;
    $('chanChip').classList.remove('hidden');
    $('episode').textContent = String(state.episode);
    $('epChip').classList.remove('hidden');
    var chip = $('stateChip');
    chip.classList.remove('hidden');
    chip.classList.toggle('live', !state.paused);
    chip.classList.toggle('paused', state.paused);
    $('stateText').textContent = state.paused ? 'Casting paused' : 'Casting on';
    var sw = $('casting');
    sw.setAttribute('aria-checked', String(!state.paused));
    $('castingTitle').textContent = state.paused ? 'Casting is paused' : 'Casting is on';
    $('castingSub').textContent = state.paused ? 'New chatters are not getting roles. Turn it on to start again.' : 'New chatters get a role.';
  }

  function renderTiles() {
    var armed = twoStep.isArmed('new-episode');
    $('newEpisode').classList.toggle('armed', armed);
    $('newTitle').textContent = armed ? 'Tap again to confirm' : 'New episode';
    $('newSub').textContent = armed ? 'This clears tonight\'s cast.' : 'Clear tonight\'s cast and start fresh.';
  }

  function memberRow(m) {
    var key = 'rm:' + m.login;
    var row = document.createElement('div');
    row.className = 'member';
    row.style.setProperty('--c', OverlayCore.nameColor(m.name));
    var av = document.createElement('div'); av.className = 'av'; av.textContent = OverlayCore.initialOf(m.name);
    var tx = document.createElement('div'); tx.className = 'tx';
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.name;
    var rl = document.createElement('span'); rl.className = 'rl'; rl.textContent = m.role;
    tx.appendChild(nm); tx.appendChild(rl);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary';
    var armed = twoStep.isArmed(key);
    btn.textContent = armed ? 'Sure?' : 'Remove';
    btn.classList.toggle('armed', armed);
    btn.setAttribute('aria-label', (armed ? 'Confirm removing ' : 'Remove ') + m.name + ' from tonight\'s cast');
    btn.addEventListener('click', function () {
      if (twoStep.press(key) === 'confirmed') {
        act('uncast', { login: m.login }, m.name + ' removed from this episode.');
      } else {
        renderCast();
        scheduleDisarm();
      }
    });
    row.appendChild(av); row.appendChild(tx); row.appendChild(btn);
    return row;
  }

  function renderCast() {
    if ((state.cast || []).length < 8 && $('filter').value) $('filter').value = ''; // never filter with a hidden box
    var q = $('filter').value.trim().toLowerCase();
    var cast = (state.cast || []).filter(function (m) {
      return !q || (m.name + ' ' + m.role).toLowerCase().indexOf(q) !== -1;
    });
    var list = $('cast');
    while (list.firstChild) list.removeChild(list.firstChild);
    ControlCore.groupCast(cast).forEach(function (g) {
      var box = document.createElement('div'); box.className = 'group'; box.dataset.tier = g.tier;
      var h = document.createElement('h3'); h.textContent = g.label + ' (' + g.members.length + ')';
      box.appendChild(h);
      g.members.forEach(function (m) { box.appendChild(memberRow(m)); });
      list.appendChild(box);
    });
    var total = (state.cast || []).length;
    $('castTitle').textContent = total ? 'Tonight\'s cast (' + total + ')' : 'Tonight\'s cast';
    $('filter').classList.toggle('hidden', total < 8);
    $('empty').classList.toggle('hidden', total > 0);
  }

  function render() { renderHeader(); renderTiles(); renderCast(); }

  // ---- talking to the server -----------------------------------------------------------------------------------
  function refresh() {
    if (refreshing || !password) return Promise.resolve();
    refreshing = true;
    var mine = ++seq;
    return api('GET', 'cast?channel=' + encodeURIComponent(channel))
      .then(function (s) { if (mine === seq && password) { state = s; render(); } })
      .catch(function (e) { if (!e.locked) toast(e.message, true); })
      .then(function () { refreshing = false; });
  }

  function act(path, extra, okText) {
    return api('POST', path, Object.assign({ channel: channel }, extra || {}))
      .then(function (res) { if (okText) toast(okText); return res; })
      .then(function (res) { refresh(); return res; })
      .catch(function (e) { if (!e.locked) toast(e.message, true); });
  }

  // ---- credits countdown --------------------------------------------------------------------------------------
  function tickCredits() {
    var left = creditsUntil - Date.now();
    var tile = $('credits');
    if (left <= 0) {
      clearInterval(creditsTimer); creditsTimer = null;
      tile.setAttribute('aria-disabled', 'false');
      $('creditsTitle').textContent = 'Roll credits';
      $('creditsSub').textContent = 'End the episode with the credits (about 45 seconds).';
      $('creditsProg').style.width = '0';
      return;
    }
    tile.setAttribute('aria-disabled', 'true');
    $('creditsTitle').textContent = 'Credits rolling';
    $('creditsSub').textContent = ControlCore.countdownLabel(left) + ' left';
    $('creditsProg').style.width = (100 - (left / CREDITS_MS) * 100) + '%';
  }

  // ---- connecting ------------------------------------------------------------------------------------------------
  function connect(e) {
    if (e) e.preventDefault();
    var msg = $('loginMsg');
    channel = SetupCore.normalizeChannel($('chan').value);
    if (!channel) { msg.textContent = 'Enter your channel name, like pixelbean.'; msg.className = 'field-msg err'; return; }
    if (!$('pw').value) { msg.textContent = 'Enter the control password.'; msg.className = 'field-msg err'; return; }
    password = $('pw').value;
    $('pw').value = '';
    msg.textContent = 'Connecting...'; msg.className = 'field-msg';
    api('GET', 'cast?channel=' + encodeURIComponent(channel)).then(function (s) {
      state = s;
      msg.textContent = '';
      $('login').classList.add('hidden');
      $('panel').classList.remove('hidden');
      $('overlayUrl').textContent = SetupCore.overlayUrl(location.origin, channel);
      render();
      clearInterval(poll);
      poll = setInterval(refresh, 4000);
    }).catch(function (err) {
      if (password) { password = ''; msg.textContent = err.message; msg.className = 'field-msg err'; }
    });
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
  $('filter').addEventListener('input', renderCast);
  $('copyOverlay').addEventListener('click', function () {
    var btn = $('copyOverlay');
    SetupCore.copyToClipboard($('overlayUrl').textContent).then(function (ok) {
      btn.textContent = ok ? 'Copied' : 'Select the link and copy it';
      btn.classList.toggle('done', ok);
      setTimeout(function () { btn.textContent = 'Copy link'; btn.classList.remove('done'); }, 3000);
    });
  });

  $('chan').value = channel;
  (channel ? $('pw') : $('chan')).focus({ preventScroll: true });
})();
