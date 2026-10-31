'use strict';
const WebSocket = require('ws');
const { defaultBackoff } = require('./backoff');

const DEFAULT_ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';
const SEEN_LIMIT = 500;


// Reads chat through Twitch EventSub over WebSocket.
// `auth.helix` makes authenticated Helix calls; `onChat` / `onRaid` receive normalized events.
function createEventSubClient({
  config, auth, log, onChat, onRaid,
  endpoint = DEFAULT_ENDPOINT, msPerSecond = 1000, backoff = defaultBackoff,
}) {
  let stopped = false;
  let current = null;       // socket we are listening on
  let pending = null;       // migration socket opened by session_reconnect, not yet welcomed
  let activeSession = null; // session id of the latest welcome
  let attempt = 0;
  let startAttempt = 0;
  let retryTimer = null;
  let botId = null;
  const channelIds = new Map(); // login -> user id
  const loginById = new Map();
  const seen = new Set();

  async function lookupUsers() {
    const logins = [...new Set([config.botUsername, ...config.channels])].filter(Boolean);
    const byLogin = new Map();
    for (let i = 0; i < logins.length; i += 100) { // Helix accepts at most 100 logins per call
      const query = logins.slice(i, i + 100).map((l) => `login=${encodeURIComponent(l)}`).join('&');
      const res = await auth.helix(`/users?${query}`);
      if (!res.ok) throw new Error(`Could not look up Twitch users (${res.status})`);
      const { data = [] } = await res.json();
      data.forEach((u) => byLogin.set(u.login.toLowerCase(), u.id));
    }
    botId = byLogin.get(config.botUsername) || null;
    if (!botId) throw new Error(`Bot account "${config.botUsername}" was not found on Twitch`);
    for (const ch of config.channels) {
      const id = byLogin.get(ch);
      if (id) { channelIds.set(ch, id); loginById.set(id, ch); } else log.warn(`Channel "${ch}" was not found on Twitch; skipping it`);
    }
  }

  // Creates every subscription in parallel (Twitch closes sessions with none within 10s).
  async function subscribe(sessionId) {
    const jobs = [];
    for (const [login, id] of channelIds) {
      for (const type of ['channel.chat.message', 'channel.chat.notification']) {
        jobs.push((async () => {
          if (activeSession !== sessionId) return false; // a newer session replaced this one
          try {
            const res = await auth.helix('/eventsub/subscriptions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type, version: '1',
                condition: { broadcaster_user_id: id, user_id: botId },
                transport: { method: 'websocket', session_id: sessionId },
              }),
            });
            if (res.ok) return type === 'channel.chat.message';
            const detail = typeof res.text === 'function' ? await res.text() : '';
            const msg = `Subscribing to ${type} for ${login} failed (${res.status}) ${detail}`.trim();
            if (type === 'channel.chat.message') log.error(msg); else log.warn(msg);
          } catch (err) {
            log.error(`Subscribing to ${type} for ${login} failed:`, err.message);
          }
          return false;
        })());
      }
    }
    const results = await Promise.all(jobs);
    if (jobs.length && activeSession === sessionId && !results.some(Boolean)) {
      log.error('No chat subscriptions were created, so no chat will arrive. Check the bot token scopes (user:read:chat) and visit /auth again.');
    }
  }

  function dispatch(msg) {
    const { subscription = {}, event = {} } = msg.payload || {};
    const channel = String(event.broadcaster_user_login || loginById.get(event.broadcaster_user_id) || '').toLowerCase();
    if (subscription.type === 'channel.chat.message') {
      const badges = Array.isArray(event.badges) ? event.badges : [];
      onChat({
        channel,
        broadcasterId: event.broadcaster_user_id,
        chatterId: event.chatter_user_id,
        chatterLogin: String(event.chatter_user_login || '').toLowerCase(),
        chatterName: event.chatter_user_name || event.chatter_user_login,
        text: (event.message && event.message.text) || '',
        isBroadcaster: event.chatter_user_id === event.broadcaster_user_id || badges.some((b) => b.set_id === 'broadcaster'),
        isMod: badges.some((b) => b.set_id === 'moderator'),
        messageType: event.message_type || 'text',
      });
    } else if (subscription.type === 'channel.chat.notification' && event.notice_type === 'raid' && event.raid) {
      onRaid({
        channel,
        raiderId: event.raid.user_id,
        raiderLogin: String(event.raid.user_login || '').toLowerCase(),
        raiderName: event.raid.user_name || event.raid.user_login,
        viewers: Number(event.raid.viewer_count) || 0,
      });
    }
  }

  function connect(url, { migrating = false } = {}) {
    if (stopped) return;
    const ws = new WebSocket(url);
    let keepaliveTimer = null;
    let timeoutMs = 15 * msPerSecond;

    const armKeepalive = () => {
      clearTimeout(keepaliveTimer);
      keepaliveTimer = setTimeout(() => {
        log.warn('EventSub went quiet; reconnecting');
        ws.terminate();
      }, timeoutMs);
    };
    armKeepalive(); // also covers a connection that never sends its welcome
    ws.on('close', () => {
      clearTimeout(keepaliveTimer);
      ws.dead = true;
      if (ws.retired || stopped) return;
      if (ws === pending) { // migration socket died before its welcome
        pending = null;
        if (!current || current.dead) scheduleReconnect();
        return;
      }
      if (ws !== current) return;
      if (pending) return; // the migration welcome will take over
      scheduleReconnect();
    });
    ws.on('error', (err) => log.warn('EventSub socket error:', err.message));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const type = msg.metadata && msg.metadata.message_type;
      if (ws.retired || stopped) return;
      armKeepalive();
      try {
        if (type === 'session_welcome') {
          const s = msg.payload.session;
          timeoutMs = (Number(s.keepalive_timeout_seconds) || 10) * msPerSecond * 1.5;
          armKeepalive();
          attempt = 0;
          activeSession = s.id;
          if (migrating) {
            const old = current;
            current = ws;
            pending = null;
            if (old && old !== ws) { old.retired = true; old.close(); }
            log.info('EventSub moved to the new connection');
          } else {
            current = ws;
            log.info('EventSub connected');
            subscribe(s.id).catch((err) => log.error('Subscribe failed:', err.message));
          }
        } else if (type === 'notification') {
          const id = msg.metadata.message_id;
          if (seen.has(id)) return;
          seen.add(id);
          if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
          dispatch(msg);
        } else if (type === 'session_reconnect') {
          if (!pending) connect(msg.payload.session.reconnect_url, { migrating: true });
        } else if (type === 'revocation') {
          log.warn('EventSub subscription revoked:', msg.payload && msg.payload.subscription && msg.payload.subscription.type);
        }
      } catch (err) {
        log.error('EventSub handler error:', err.stack || err.message);
      }
    });
    if (migrating) pending = ws; else current = ws;
    return ws;
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    const delay = backoff(attempt++);
    log.warn(`EventSub disconnected; reconnecting in ${delay}ms`);
    retryTimer = setTimeout(() => { retryTimer = null; connect(endpoint); }, delay);
  }

  // Looks up user ids, then connects. Retries with backoff if the lookup fails
  // (for example before the first /auth login, or on a network error).
  async function tryStart() {
    retryTimer = null;
    if (stopped) return;
    try {
      await lookupUsers();
      startAttempt = 0;
      connect(endpoint);
    } catch (err) {
      const delay = backoff(startAttempt++);
      log.warn(`EventSub could not start (${err.message}); retrying in ${delay}ms`);
      if (!stopped) retryTimer = setTimeout(tryStart, delay);
    }
  }

  return {
    start: tryStart,
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      for (const sock of [current, pending]) {
        if (sock) { sock.retired = true; sock.close(); }
      }
    },
  };
}

module.exports = { createEventSubClient };
