'use strict';
const WebSocket = require('ws');

const DEFAULT_ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';
const SEEN_LIMIT = 500;

// Exponential backoff: 1s, 2s, 4s ... capped at 30s.
const defaultBackoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt);

// Reads chat through Twitch EventSub over WebSocket.
// `auth.helix` makes authenticated Helix calls; `onChat` / `onRaid` receive normalized events.
function createEventSubClient({
  config, auth, log, onChat, onRaid,
  endpoint = DEFAULT_ENDPOINT, msPerSecond = 1000, backoff = defaultBackoff,
}) {
  let stopped = false;
  let current = null;       // socket we are listening on
  let attempt = 0;
  let retryTimer = null;
  let botId = null;
  const channelIds = new Map(); // login -> user id
  const loginById = new Map();
  const seen = new Set();

  async function lookupUsers() {
    const logins = [config.botUsername, ...config.channels];
    const query = [...new Set(logins)].map((l) => `login=${encodeURIComponent(l)}`).join('&');
    const res = await auth.helix(`/users?${query}`);
    if (!res.ok) throw new Error(`Could not look up Twitch users (${res.status})`);
    const { data = [] } = await res.json();
    const byLogin = new Map(data.map((u) => [u.login.toLowerCase(), u.id]));
    botId = byLogin.get(config.botUsername) || null;
    if (!botId) throw new Error(`Bot account "${config.botUsername}" was not found on Twitch`);
    for (const ch of config.channels) {
      const id = byLogin.get(ch);
      if (id) { channelIds.set(ch, id); loginById.set(id, ch); } else log.warn(`Channel "${ch}" was not found on Twitch; skipping it`);
    }
  }

  async function subscribe(sessionId) {
    for (const [login, id] of channelIds) {
      for (const type of ['channel.chat.message', 'channel.chat.notification']) {
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
          if (!res.ok) {
            const detail = typeof res.text === 'function' ? await res.text() : '';
            const msg = `Subscribing to ${type} for ${login} failed (${res.status}) ${detail}`.trim();
            if (type === 'channel.chat.message') log.error(msg); else log.warn(msg);
          }
        } catch (err) {
          log.error(`Subscribing to ${type} for ${login} failed:`, err.message);
        }
      }
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
    ws.on('close', () => {
      clearTimeout(keepaliveTimer);
      if (ws.retired || stopped) return;
      // A migration socket that dies before its welcome changes nothing: the old socket
      // stays current, and Twitch closes it (code 4004), which triggers a normal reconnect.
      if (ws !== current) return;
      scheduleReconnect();
    });
    ws.on('error', (err) => log.warn('EventSub socket error:', err.message));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const type = msg.metadata && msg.metadata.message_type;
      if (type !== 'session_welcome' && ws.retired) return;
      armKeepalive();
      try {
        if (type === 'session_welcome') {
          const s = msg.payload.session;
          timeoutMs = (Number(s.keepalive_timeout_seconds) || 10) * msPerSecond * 1.5;
          armKeepalive();
          attempt = 0;
          if (migrating) {
            const old = current;
            current = ws;
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
          connect(msg.payload.session.reconnect_url, { migrating: true });
        } else if (type === 'revocation') {
          log.warn('EventSub subscription revoked:', msg.payload && msg.payload.subscription && msg.payload.subscription.type);
        }
      } catch (err) {
        log.error('EventSub handler error:', err.stack || err.message);
      }
    });
    if (!migrating) current = ws;
    return ws;
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    const delay = backoff(attempt++);
    log.warn(`EventSub disconnected; reconnecting in ${delay}ms`);
    retryTimer = setTimeout(() => { retryTimer = null; connect(endpoint); }, delay);
  }

  return {
    async start() {
      await lookupUsers();
      connect(endpoint);
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      if (current) { current.retired = true; current.close(); }
    },
  };
}

module.exports = { createEventSubClient };
