// Sound for the overlay: the sting when a card is revealed and the theme under the credits.
// Plays public/audio/sting.mp3 and theme.mp3 when they exist, otherwise a short synthesized stand-in.
// No markup in here; the overlay calls OverlaySound.playSting(), playTheme(ms) and stopTheme().
(function (root) {
  var VOLUME = 0.4;
  var ctx = null;
  var themeMaster = null;

  function makeFile(url, onKnown) {
    var a = new Audio(url);
    a.preload = 'auto';
    a.volume = VOLUME;
    a.addEventListener('error', function () { onKnown(false); });
    a.addEventListener('canplaythrough', function () { onKnown(true); });
    return a;
  }
  var stingKnown = null;
  var themeKnown = null;
  var stingFile = makeFile('audio/sting.mp3', function (ok) { stingKnown = ok; });
  var themeFile = makeFile('audio/theme.mp3', function (ok) { themeKnown = ok; });

  function audioContext() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(c, dest, midi, when, len, type, vol) {
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    o.connect(g); g.connect(dest);
    o.start(when); o.stop(when + len + 0.05);
  }
  function play(file) {
    file.currentTime = 0;
    var p = file.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked: stay silent */ });
  }

  function playSting() {
    if (stingKnown === true) { play(stingFile); return; }
    try {
      var c = audioContext();
      var out = c.createGain();
      out.gain.value = VOLUME * 0.6;
      out.connect(c.destination);
      [72, 76, 79, 84].forEach(function (m, i) { tone(c, out, m, c.currentTime + i * 0.09, 0.5, 'triangle', 1); });
    } catch (e) { /* audio is optional */ }
  }

  function playTheme(ms) {
    if (themeKnown === true) { play(themeFile); return; }
    try {
      var c = audioContext();
      var melody = [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 72];
      var step = 0.22;
      var t0 = c.currentTime + 0.1;
      var total = ms / 1000;
      var master = c.createGain();
      master.gain.setValueAtTime(VOLUME * 0.5, t0);
      master.gain.setValueAtTime(VOLUME * 0.5, t0 + total - 3);
      master.gain.linearRampToValueAtTime(0.0001, t0 + total);
      master.connect(c.destination);
      themeMaster = master;
      for (var i = 0; i * step < total - 0.3; i++) {
        var m = melody[i % melody.length];
        tone(c, master, m, t0 + i * step, 0.3, 'triangle', 0.5);
        if (i % 4 === 0) tone(c, master, m - 24, t0 + i * step, 0.8, 'sine', 0.6);
      }
    } catch (e) { /* audio is optional */ }
  }

  function stopTheme() {
    try { themeFile.pause(); } catch (e) { /* nothing playing */ }
    if (themeMaster) { try { themeMaster.disconnect(); } catch (e) { /* already gone */ } themeMaster = null; }
  }

  root.OverlaySound = { playSting: playSting, playTheme: playTheme, stopTheme: stopTheme };
})(window);
