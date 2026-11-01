// Small pure helpers for the control room (also unit tested in Node).
(function (root) {
  // "Tap again to confirm": the first press arms an action, a second press within the window runs it.
  function createTwoStep(opts) {
    var now = (opts && opts.now) || Date.now;
    var windowMs = (opts && opts.windowMs) || 4000;
    var armedKey = null;
    var armedAt = 0;
    function isArmed(key) { return armedKey === key && now() - armedAt <= windowMs; }
    return {
      isArmed: isArmed,
      press: function (key) {
        if (isArmed(key)) { armedKey = null; return 'confirmed'; }
        armedKey = key; armedAt = now();
        return 'armed';
      },
      reset: function () { armedKey = null; },
    };
  }

  var GROUPS = [['regular', 'Series regulars'], ['cast', 'Starring'], ['guest', 'Special guest stars'], ['lurk', 'Background extras']];

  // Tonight's cast grouped by rarity tier, in a fixed order, without empty groups.
  function groupCast(cast) {
    var list = Array.isArray(cast) ? cast : [];
    var tierOf = (root.OverlayCore && root.OverlayCore.tierOf) || (typeof require !== 'undefined' ? require('./overlay-core').tierOf : null);
    return GROUPS.map(function (g) {
      return { tier: g[0], label: g[1], members: list.filter(function (m) { return tierOf(m) === g[0]; }) };
    }).filter(function (g) { return g.members.length > 0; });
  }

  function countdownLabel(ms) {
    return Math.max(0, Math.ceil(ms / 1000)) + 's';
  }

  var api = { createTwoStep: createTwoStep, groupCast: groupCast, countdownLabel: countdownLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ControlCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
