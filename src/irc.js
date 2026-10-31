'use strict';
const WebSocket = require('ws');

const DEFAULT_ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443';
const defaultBackoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt);

const unescapeTag = (v) =>
  v.replace(/\\(.)/g, (_m, c) => ({ s: ' ', n: '\n', r: '\r', ':': ';', '\\': '\\' }[c] ?? c));

// Parses one IRC line (with optional IRCv3 tags) into { tags, nick, command, params, trailing }.
function parseIrcLine(line) {
  let rest = line;
  const tags = {};
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    for (const part of rest.slice(1, end).split(';')) {
      const eq = part.indexOf('=');
      tags[eq === -1 ? part : part.slice(0, eq)] = eq === -1 ? '' : unescapeTag(part.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let nick = '';
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    nick = rest.slice(1, end).split('!')[0];
    rest = rest.slice(end + 1);
  }
  let trailing = '';
  const t = rest.indexOf(' :');
  if (t !== -1) { trailing = rest.slice(t + 2); rest = rest.slice(0, t); }
  const [command, ...params] = rest.split(' ').filter(Boolean);
  return { tags, nick, command, params, trailing };
}

// Anonymous, read-only chat reader. A backup for when EventSub tokens are not set up.
function createIrcClient({ config, log, onChat, onRaid, endpoint = DEFAULT_ENDPOINT, backoff = defaultBackoff }) {
  let stopped = false;
  let ws = null;
  let attempt = 0;
  let retryTimer = null;

  function handleLine(raw) {
    const m = parseIrcLine(raw);
    if (m.command === 'PING') { ws.send(`PONG :${m.trailing}`); return; }
    const channel = (m.params[0] || '').replace(/^#/, '').toLowerCase();
    if (m.command === 'PRIVMSG') {
      const badges = (m.tags.badges || '').split(',').map((b) => b.split('/')[0]);
      onChat({
        channel,
        broadcasterId: m.tags['room-id'],
        chatterId: m.tags['user-id'],
        chatterLogin: m.nick.toLowerCase(),
        chatterName: m.tags['display-name'] || m.nick,
        text: m.trailing,
        isBroadcaster: badges.includes('broadcaster'),
        isMod: badges.includes('moderator'),
        messageType: 'text',
      });
    } else if (m.command === 'USERNOTICE' && m.tags['msg-id'] === 'raid') {
      onRaid({
        channel,
        raiderId: m.tags['user-id'],
        raiderLogin: String(m.tags.login || '').toLowerCase(),
        raiderName: m.tags['msg-param-displayName'] || m.tags.login,
        viewers: Number(m.tags['msg-param-viewerCount']) || 0,
      });
    }
  }

  function connect() {
    if (stopped) return;
    const sock = new WebSocket(endpoint);
    ws = sock;
    sock.on('open', () => {
      attempt = 0;
      sock.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      sock.send('PASS SCHMOOPIIE');
      sock.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      for (const c of config.channels) sock.send(`JOIN #${c}`);
      log.info('IRC connected (anonymous, read-only)');
    });
    sock.on('message', (data) => {
      for (const line of data.toString().split('\r\n')) {
        if (!line) continue;
        try { handleLine(line); } catch (err) { log.error('IRC handler error:', err.stack || err.message); }
      }
    });
    sock.on('error', (err) => log.warn('IRC socket error:', err.message));
    sock.on('close', () => {
      if (stopped || sock !== ws) return;
      const delay = backoff(attempt++);
      log.warn(`IRC disconnected; reconnecting in ${delay}ms`);
      retryTimer = setTimeout(connect, delay);
    });
  }

  return {
    start() { connect(); },
    stop() { stopped = true; clearTimeout(retryTimer); if (ws) ws.close(); },
  };
}

module.exports = { createIrcClient, parseIrcLine };
