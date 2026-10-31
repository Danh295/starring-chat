const { test } = require('node:test');
const assert = require('node:assert');
const { WebSocketServer } = require('ws');
const { createIrcClient, parseIrcLine } = require('../src/irc');

const quiet = { info() {}, warn() {}, error() {} };
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('timed out');
};

test('parseIrcLine splits tags, prefix, command, params and trailing text', () => {
  const m = parseIrcLine('@badges=moderator/1;display-name=Vi\\sewer;user-id=5 :vi!vi@vi.tmi.twitch.tv PRIVMSG #chan :hi : there');
  assert.strictEqual(m.command, 'PRIVMSG');
  assert.strictEqual(m.tags['display-name'], 'Vi ewer');
  assert.strictEqual(m.tags['user-id'], '5');
  assert.deepStrictEqual(m.params, ['#chan']);
  assert.strictEqual(m.trailing, 'hi : there');
  assert.strictEqual(m.nick, 'vi');
});

async function setup(t, channels = ['chana']) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  const received = [];
  let sock;
  wss.on('connection', (ws) => { sock = ws; ws.on('message', (d) => received.push(d.toString().trim())); });
  const events = { chat: [], raid: [] };
  const client = createIrcClient({
    config: { channels }, log: quiet, endpoint: `ws://127.0.0.1:${wss.address().port}`,
    onChat: (e) => events.chat.push(e), onRaid: (e) => events.raid.push(e), backoff: () => 10,
  });
  t.after(() => { client.stop(); wss.clients.forEach((c) => c.terminate()); wss.close(); });
  client.start();
  await until(() => sock);
  return { received, events, send: (l) => sock.send(l + '\r\n'), get sock() { return sock; } };
}

test('logs in anonymously (justinfan), requests tags and joins channels', async (t) => {
  const s = await setup(t, ['chana', 'chanb']);
  await until(() => s.received.some((l) => l === 'JOIN #chanb'));
  assert.ok(s.received.some((l) => l.startsWith('CAP REQ :twitch.tv/tags twitch.tv/commands')));
  assert.ok(s.received.some((l) => l === 'PASS SCHMOOPIIE'));
  assert.ok(s.received.some((l) => /^NICK justinfan\d+$/.test(l)));
  assert.ok(s.received.some((l) => l === 'JOIN #chana'));
});

test('PRIVMSG becomes a chat event; badges set flags', async (t) => {
  const s = await setup(t);
  s.send('@badges=moderator/1;display-name=Viewer;user-id=5;room-id=10 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #chana :hello world');
  s.send('@badges=broadcaster/1;display-name=Chana;user-id=10;room-id=10 :chana!chana@chana.tmi.twitch.tv PRIVMSG #chana :!credits');
  await until(() => s.events.chat.length === 2);
  assert.deepStrictEqual(s.events.chat[0], {
    channel: 'chana', broadcasterId: '10', chatterId: '5', chatterLogin: 'viewer', chatterName: 'Viewer',
    text: 'hello world', isBroadcaster: false, isMod: true, messageType: 'text',
  });
  assert.strictEqual(s.events.chat[1].isBroadcaster, true);
});

test('raid USERNOTICE becomes a raid event; other notices are ignored', async (t) => {
  const s = await setup(t);
  s.send('@msg-id=raid;login=raider;msg-param-displayName=Raider;msg-param-viewerCount=17;user-id=77 :tmi.twitch.tv USERNOTICE #chana');
  s.send('@msg-id=sub;login=someone :tmi.twitch.tv USERNOTICE #chana :hi');
  await until(() => s.events.raid.length === 1);
  assert.deepStrictEqual(s.events.raid[0], { channel: 'chana', raiderId: '77', raiderLogin: 'raider', raiderName: 'Raider', viewers: 17 });
});

test('answers PING with PONG', async (t) => {
  const s = await setup(t);
  s.send('PING :tmi.twitch.tv');
  await until(() => s.received.includes('PONG :tmi.twitch.tv'));
});

test('reconnects and rejoins after the socket drops', async (t) => {
  const s = await setup(t);
  await until(() => s.received.includes('JOIN #chana'));
  s.received.length = 0;
  s.sock.terminate();
  await until(() => s.received.includes('JOIN #chana'));
});

test('a throwing handler does not break parsing', async (t) => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  let sock; wss.on('connection', (ws) => { sock = ws; });
  let n = 0; const got = [];
  const client = createIrcClient({
    config: { channels: ['c'] }, log: quiet, endpoint: `ws://127.0.0.1:${wss.address().port}`,
    onChat: (e) => { if (n++ === 0) throw new Error('x'); got.push(e); }, onRaid() {}, backoff: () => 10,
  });
  t.after(() => { client.stop(); wss.clients.forEach((c) => c.terminate()); wss.close(); });
  client.start();
  await until(() => sock);
  sock.send('@user-id=1;display-name=A :a!a@a PRIVMSG #c :one\r\n@user-id=2;display-name=B :b!b@b PRIVMSG #c :two\r\n');
  await until(() => got.length === 1);
});
