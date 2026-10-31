'use strict';

// Looks up a channel's current game/category (cached), never throwing and never waiting long.
function createCategoryLookup({ auth, now = Date.now, ttlMs = 5 * 60_000, timeoutMs = 1000 }) {
  const cache = new Map(); // broadcasterId -> { value, at }
  return async function getCategory(broadcasterId) {
    if (!auth || !broadcasterId) return '';
    const hit = cache.get(broadcasterId);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    let timer;
    try {
      const fetchIt = (async () => {
        const res = await auth.helix(`/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`);
        if (!res.ok) return '';
        const { data = [] } = await res.json();
        return (data[0] && data[0].game_name) || '';
      })();
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
      const value = await Promise.race([fetchIt, timeout]);
      if (value === null) return '';
      cache.set(broadcasterId, { value, at: now() });
      return value;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createCategoryLookup };
