// Pure card-queue logic, shared by the overlay (browser) and the tests (Node).
(function (root) {
  // Shows one card at a time: show(card) -> wait(card, skipped) -> hide(card). `skipped` is a promise
  // that resolves when the current card should end early; hide may return a promise (exit animation).
  // Waiting cards beyond `max` drop oldest first.
  function createCardQueue({ show, hide, wait, max = 20 }) {
    const items = [];
    let running = null;
    let active = false;
    let current = null;
    let phase = 'idle';
    let skipCurrent = () => {};

    async function loop() {
      while (items.length) {
        const card = items.shift();
        current = card;
        try {
          const skipped = new Promise((resolve) => { skipCurrent = resolve; });
          phase = 'showing';
          show(card);
          await wait(card, skipped);
          phase = 'hiding';
          await hide(card);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('card failed', err);
        }
        current = null;
        phase = 'idle';
      }
      active = false;
    }

    return {
      push(card) {
        if (items.length >= max) items.shift();
        items.push(card);
        if (!active) { active = true; running = loop(); }
      },
      clear() { items.length = 0; },
      skip() { skipCurrent(); },
      reset() { items.length = 0; skipCurrent(); },
      // Removes waiting cards matching `pred`, and ends the current one early if it matches.
      removeWhere(pred) {
        let n = 0;
        for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) { items.splice(i, 1); n++; }
        if (current && phase === 'showing' && pred(current)) { skipCurrent(); n++; }
        return n;
      },
      idle: () => running || Promise.resolve(),
    };
  }

  const LABELS = { cast: 'STARRING', guest: 'SPECIAL GUEST STAR', lurk: 'BACKGROUND EXTRA' };
  const text = (v, fallback, max) => {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return (s || fallback).slice(0, max);
  };

  // Everything the card needs to display, from an untrusted event.
  function cardModel(msg) {
    const m = msg && typeof msg === 'object' ? msg : {};
    const kind = LABELS[m.kind] ? m.kind : 'cast';
    const regular = kind === 'cast' && m.regular === true;
    return {
      className: kind + (regular ? ' regular' : ''),
      label: LABELS[kind],
      who: '@' + text(m.user, 'someone', 25) + ' as',
      role: text(m.role, 'The Mystery Guest', 44),
      logline: text(m.logline, '', 110),
      badge: regular ? 'SERIES REGULAR' : '',
    };
  }

  const entries = (list) => (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e === 'object')
    .slice(0, 200)
    .map((e) => ({ user: text(e.user, 'someone', 25), role: text(e.role, 'The Mystery Guest', 44), regular: e.regular === true }));

  // Everything the credits roll needs to display, from an untrusted event.
  function creditsModel(msg) {
    const m = msg && typeof msg === 'object' ? msg : {};
    const ms = Number(m.scrollMs);
    return {
      title: text(m.title, 'The One With Everyone', 100),
      starring: entries(m.starring),
      guests: entries(m.guests),
      extras: entries(m.extras),
      directedBy: text(m.directedBy, '', 40),
      castingBy: text(m.castingBy, 'Starring: Chat', 40),
      compact: m.compact === true,
      scrollMs: Number.isFinite(ms) ? Math.min(90000, Math.max(20000, ms)) : 45000,
    };
  }

  const api = { createCardQueue, cardModel, creditsModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OverlayCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
