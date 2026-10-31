// Pure card-queue logic, shared by the overlay (browser) and the tests (Node).
(function (root) {
  // Shows one card at a time: show(card) -> wait(card) -> hide(card) (hide may return a promise
  // that resolves when the exit animation ends). Waiting cards beyond `max` drop oldest first.
  function createCardQueue({ show, hide, wait, max = 20 }) {
    const items = [];
    let running = null;
    let active = false;

    async function loop() {
      while (items.length) {
        const card = items.shift();
        try {
          show(card);
          await wait(card);
          await hide(card);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('card failed', err);
        }
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
      idle: () => running || Promise.resolve(),
    };
  }

  const api = { createCardQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OverlayCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
