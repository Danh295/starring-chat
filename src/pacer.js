'use strict';

// Wraps `emit` so role cards leave at most one per `intervalMs` per channel. Cards are queued,
// never dropped (except the oldest when a flood exceeds `maxQueue`), so everyone still reaches
// the cast and the credits. Other events pass straight through.
function createPacer({ emit, intervalMs = 8000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, maxQueue = 100 }) {
  const channels = new Map(); // channel -> { queue, nextAt, timer }
  const state = (c) => {
    if (!channels.has(c)) channels.set(c, { queue: [], nextAt: 0, timer: null });
    return channels.get(c);
  };

  function pump(channel) {
    const st = state(channel);
    if (st.timer) return;
    const wait = st.nextAt - now();
    if (wait > 0) {
      st.timer = setTimer(() => { st.timer = null; pump(channel); }, wait);
      return;
    }
    const ev = st.queue.shift();
    if (!ev) return;
    emit(channel, ev);
    st.nextAt = now() + intervalMs;
    if (st.queue.length) pump(channel);
  }

  return {
    emit(channel, ev) {
      if (!ev || ev.type !== 'cast' || intervalMs <= 0) {
        if (ev && (ev.type === 'episode' || ev.type === 'credits')) state(channel).queue.length = 0;
        if (ev && ev.type === 'uncast') {
          const st = state(channel);
          st.queue = st.queue.filter((c) => c.login !== ev.login);
        }
        return emit(channel, ev);
      }
      const st = state(channel);
      if (st.queue.length >= maxQueue) st.queue.shift();
      st.queue.push(ev);
      pump(channel);
      return 1;
    },
    stop() {
      for (const st of channels.values()) { clearTimer(st.timer); st.timer = null; st.queue.length = 0; }
    },
  };
}

module.exports = { createPacer };
