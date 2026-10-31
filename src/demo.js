'use strict';

const VIEWERS = [
  { id: 'd1', login: 'pixelbean', name: 'PixelBean', at: 5, text: 'this snack run is going to be legendary' },
  { id: 'd2', login: 'nightowl42', name: 'NightOwl42', at: 22, text: 'anyone else playing until 3am again lol' },
  { id: 'd3', login: 'cozycat', name: 'CozyCat', at: 40, text: 'love the chill music tonight' },
  { id: 'd4', login: 'turbotoast', name: 'TurboToast', at: 58, text: 'that boss was so close, next try for sure' },
  { id: 'd5', login: 'mossymage', name: 'MossyMage', at: 82, text: 'can we get a tip for the final level' },
  { id: 'd6', login: 'quietstorm', name: 'QuietStorm', at: 104, text: 'big fan of this overlay, it looks like a tv show' },
];
const LURKER = { id: 'd7', login: 'lurkinglarry', name: 'LurkingLarry', at: 70, text: '!lurk' };
const RAID = { at: 130, raiderId: 'd8', raiderLogin: 'raidmaster', raiderName: 'RaidMaster', viewers: 27 };
const CREDITS_AT = 165;

// The scripted chat: 6 viewers, a lurker, a raid and the broadcaster typing !credits, spread
// over about three minutes (divided by `speed`).
function buildTimeline({ channel, speed = 1 }) {
  const ms = (s) => Math.round((s * 1000) / speed);
  const chat = (v, extra = {}) => ({
    type: 'chat', atMs: ms(v.at), channel, broadcasterId: 'demo-broadcaster',
    chatterId: v.id, chatterLogin: v.login, chatterName: v.name, text: v.text,
    isBroadcaster: false, isMod: false, messageType: 'text', ...extra,
  });
  const events = [
    ...VIEWERS.map((v) => chat(v)),
    chat(LURKER),
    { type: 'raid', atMs: ms(RAID.at), channel, raiderId: RAID.raiderId, raiderLogin: RAID.raiderLogin, raiderName: RAID.raiderName, viewers: RAID.viewers },
    chat({ id: 'demo-broadcaster', login: channel, name: channel, at: CREDITS_AT, text: '!credits' }, { isBroadcaster: true }),
  ];
  return events.sort((a, b) => a.atMs - b.atMs);
}

// Plays the scripted chat through the same handlers real chat uses. It starts when an overlay
// connects (so nobody misses it) and can run again after it finishes.
function createDemo({
  channel, speed = 1, onChat, onRaid, onStart = () => {}, log,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, cooldownMs = Math.round(60_000 / speed),
}) {
  let running = false;
  let cooldownUntil = 0;
  let handles = [];

  function dispatch(ev) {
    const { type, atMs, ...payload } = ev; // eslint-disable-line no-unused-vars
    try {
      if (type === 'raid') onRaid(payload); else onChat(payload);
    } catch (err) {
      log.error('Demo event failed:', err.message);
    }
  }

  return {
    ensureRunning() {
      if (running || now() < cooldownUntil) return false;
      running = true;
      try { onStart(); } catch (err) { log.error('Demo start failed:', err.message); }
      const timeline = buildTimeline({ channel, speed });
      handles = timeline.map((ev, i) => setTimer(() => {
        dispatch(ev);
        if (i === timeline.length - 1) { running = false; cooldownUntil = now() + cooldownMs; handles = []; }
      }, ev.atMs));
      log.info(`Demo started: ${timeline.length} scripted events over about ${Math.round(timeline.at(-1).atMs / 1000)}s`);
      return true;
    },
    stop() {
      handles.forEach((h) => clearTimer(h));
      handles = [];
      running = false;
    },
  };
}

module.exports = { buildTimeline, createDemo };
