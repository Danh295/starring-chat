'use strict';
const { WebSocketServer } = require('ws');

const CHANNEL_RE = /^[a-z0-9_]{1,25}$/;
const isValidChannel = (c) => typeof c === 'string' && CHANNEL_RE.test(c);

// WebSocket hub for overlays. Overlays connect to /ws?channel=<login> and receive
// only that channel's events. Everything sent here is already public on stream.
function createHub({ server, log, maxPerChannel = 25, heartbeatMs = 30_000, onConnect = () => {} }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map(); // channel -> Set<ws>

  const reject = (socket, status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reject(socket, 400, 'Bad Request'); }
    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found');
    const channel = url.searchParams.get('channel');
    if (!isValidChannel(channel)) return reject(socket, 400, 'Bad Request');
    if ((clients.get(channel) || new Set()).size >= maxPerChannel) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => {});
      ws.on('close', () => {
        const set = clients.get(channel);
        if (set) { set.delete(ws); if (!set.size) clients.delete(channel); }
      });
      if (!clients.has(channel)) clients.set(channel, new Set());
      clients.get(channel).add(ws);
      ws.send(JSON.stringify({ type: 'hello', channel }));
      try { onConnect(channel, ws); } catch (err) { log.error('Hub onConnect failed:', err.message); }
    });
  });

  const timer = setInterval(() => {
    for (const set of clients.values()) {
      for (const ws of set) {
        if (!ws.alive) { ws.terminate(); continue; }
        ws.alive = false;
        try { ws.ping(); } catch { /* socket already gone */ }
      }
    }
  }, heartbeatMs);
  timer.unref();

  return {
    broadcast(channel, event) {
      const set = clients.get(channel);
      if (!set) return 0;
      const data = JSON.stringify(event);
      let n = 0;
      for (const ws of set) if (ws.readyState === 1) { ws.send(data); n++; }
      return n;
    },
    clientCount: (channel) => (clients.get(channel) || new Set()).size,
    close() {
      clearInterval(timer);
      for (const set of clients.values()) for (const ws of set) ws.terminate();
      clients.clear();
      wss.close();
    },
  };
}

module.exports = { createHub, isValidChannel };
