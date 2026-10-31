'use strict';
const crypto = require('node:crypto');
const { isValidChannel } = require('./hub');

const KNOWN_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'soundalerts', 'wizebot'];
const REGULAR_FROM_EPISODE = 3;

const LURK_ROLES = [
  ['The Silent Observer', 'Watching every scene from the back row.'],
  ['The Background Legend', 'Never in the spotlight, always in the room.'],
  ['The Mysterious Extra', 'Appears in the corner of every frame.'],
  ['The Quiet Companion', 'Here for the vibes and the whole episode.'],
  ['The Cozy Spectator', 'Wrapped in a blanket, fully invested.'],
  ['The Undercover Fan', 'Says nothing, notices everything.'],
  ['The Gentle Ghost', 'Haunts the chat with good intentions.'],
  ['The Popcorn Holder', 'Front row seat, no spoilers.'],
];

const { hasLink } = require('./links');

const cleanName = (n, fallback) => String(n || fallback || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 25) || String(fallback || 'Someone');
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// The casting director. Decides who gets cast, keeps per-channel episode state, and emits
// overlay events. Everything outside this module (chat, OpenAI, storage, overlay) is injected.
function createCastingEngine({
  config, store, roles, emit, getCategory = async () => '', announce = async () => {},
  onCredits = () => {}, log, now = Date.now,
}) {
  const channels = new Map();
  let optoutsAll = null;
  const maxCast = () => config.maxCastPerEpisode || 40;

  function loadOptouts() {
    if (!optoutsAll) optoutsAll = store.read('optouts.json', {}) || {};
    return optoutsAll;
  }

  function state(channel) {
    let st = channels.get(channel);
    if (st) return st;
    const file = store.read(`cast-${channel}.json`, null);
    const members = file && typeof file.members === 'object' && file.members ? file.members : {};
    // A restart soon after the last activity resumes the same episode (and its cast) instead
    // of starting a new one, so a crash mid-stream does not double-count appearances.
    const window = config.resumeWindowMs === undefined ? 2 * 3600_000 : config.resumeWindowMs;
    const lastEpisode = (file && Number(file.episode)) || 0;
    const resume = Boolean(file) && lastEpisode > 0 && window > 0 && now() - (Number(file.updatedAt) || 0) <= window;
    st = {
      episode: resume ? lastEpisode : lastEpisode + 1,
      epoch: 0,
      members,
      cast: new Map(),
      blocked: new Set(),
      inFlight: new Set(),
      paused: false,
      optouts: new Set(loadOptouts()[channel] || []),
    };
    if (resume) {
      for (const [login, m] of Object.entries(members)) {
        if (m && m.lastEpisode === st.episode) {
          st.cast.set(login, {
            login, name: m.name, kind: m.kind || 'cast', role: m.role, logline: m.logline,
            regular: (m.kind || 'cast') === 'cast' && m.episodes >= REGULAR_FROM_EPISODE, episode: st.episode,
          });
        }
      }
    }
    channels.set(channel, st);
    return st;
  }

  // Undo this episode's appearance (used by !uncast) so removed viewers earn no Series Regular progress.
  function forgetAppearance(st, login) {
    const m = st.members[login];
    if (!m || m.lastEpisode !== st.episode) return;
    m.episodes -= 1;
    if (m.episodes <= 0) delete st.members[login]; else m.lastEpisode = st.episode - 1;
  }

  const save = (channel, st) =>
    store.write(`cast-${channel}.json`, { channel, episode: st.episode, updatedAt: now(), members: st.members })
      .catch((err) => log.error(`Could not save cast for ${channel}:`, err.message));

  const saveOptouts = (channel, st) => {
    loadOptouts()[channel] = [...st.optouts];
    return store.write('optouts.json', optoutsAll).catch((err) => log.error('Could not save opt-outs:', err.message));
  };

  function skipReason(st, login, e) {
    if (e && e.isBroadcaster) return 'broadcaster';
    if (login === config.botUsername || KNOWN_BOTS.includes(login)) return 'bot';
    if (st.optouts.has(login)) return 'optout';
    if (st.blocked.has(login)) return 'blocked';
    if (st.cast.has(login) || st.inFlight.has(login)) return 'already';
    if (st.paused) return 'paused';
    return null;
  }

  function commit(channel, st, { login, name, kind, role, logline, broadcasterId, how }) {
    const prev = st.members[login];
    const episodes = (prev && prev.lastEpisode === st.episode) ? prev.episodes : ((prev && prev.episodes) || 0) + 1;
    const regular = kind === 'cast' && episodes >= REGULAR_FROM_EPISODE;
    st.members[login] = { name, episodes, lastEpisode: st.episode, role, logline, kind };
    const entry = { login, name, kind, role, logline, regular, episode: st.episode };
    st.cast.set(login, entry);
    emit(channel, { type: 'cast', id: crypto.randomUUID(), channel, kind, user: name, login, role, logline, regular, episode: st.episode });
    const one = (v) => String(v).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 80); // keep the log one line per cast
    log.info(`Cast @${one(login)} as ${one(role)} in ${one(channel)} (${one(how || kind)})`);
    save(channel, st);
    if (kind === 'cast' && config.announceInChat && broadcasterId) {
      Promise.resolve(announce(broadcasterId, `Now starring @${name} as ${role}`)).catch(() => {});
    }
    return entry;
  }

  function removeFromCast(channel, st, login) {
    const had = st.cast.delete(login);
    if (had) emit(channel, { type: 'uncast', channel, login });
    return had;
  }

  async function castChatter(channel, st, e, login, text) {
    const reason = skipReason(st, login, e);
    if (reason) return { action: 'ignored', reason };
    if (st.cast.size + st.inFlight.size >= maxCast()) return { action: 'ignored', reason: 'cap' };
    st.inFlight.add(login);
    const epoch = st.epoch;
    try {
      let category = '';
      try { category = await getCategory(e.broadcasterId); } catch { /* optional */ }
      let r;
      try {
        r = await roles.writeRole({ text, category, avoid: [...st.cast.values()].map((c) => c.role) });
      } catch (err) {
        log.warn('Role writer failed:', err.message);
      }
      if (!r || !r.role) r = { role: 'The Mystery Guest', logline: 'Arrived without a script.', source: 'fallback', reason: 'error' };
      if (epoch !== st.epoch || st.optouts.has(login) || st.blocked.has(login)) return { action: 'ignored', reason: 'changed' };
      const entry = commit(channel, st, {
        login, name: cleanName(e.chatterName, login), kind: 'cast', role: r.role, logline: r.logline, broadcasterId: e.broadcasterId,
        how: r.source === 'fallback' ? `fallback${r.reason ? ': ' + r.reason : ''}` : (r.source || 'ai'),
      });
      return { action: 'cast', entry, source: r.source };
    } finally {
      if (epoch === st.epoch) st.inFlight.delete(login);
    }
  }

  function castLurker(channel, st, e, login) {
    const reason = skipReason(st, login, e);
    if (reason) return { action: 'ignored', reason };
    if (st.cast.size + st.inFlight.size >= maxCast()) return { action: 'ignored', reason: 'cap' };
    const [role, logline] = LURK_ROLES[hash(login) % LURK_ROLES.length];
    const entry = commit(channel, st, { login, name: cleanName(e.chatterName, login), kind: 'lurk', role, logline });
    return { action: 'cast', entry };
  }

  function optOut(channel, st, login) {
    st.optouts.add(login);
    removeFromCast(channel, st, login);
    delete st.members[login];
    saveOptouts(channel, st);
    save(channel, st);
    return { action: 'optout' };
  }

  function startNewEpisode(channel) {
    const st = state(channel);
    st.episode += 1;
    st.epoch += 1;
    st.cast.clear();
    st.blocked.clear();
    st.inFlight.clear();
    emit(channel, { type: 'episode', channel, episode: st.episode });
    save(channel, st);
    return st.episode;
  }

  async function processChat(e) {
    const channel = String(e.channel || '').toLowerCase();
    if (!isValidChannel(channel)) return { action: 'ignored', reason: 'channel' };
    const login = String(e.chatterLogin || '').toLowerCase();
    if (!login) return { action: 'ignored', reason: 'login' };
    const text = String(e.text || '').trim();
    if (!text) return { action: 'ignored', reason: 'empty' };
    const st = state(channel);
    const privileged = Boolean(e.isMod || e.isBroadcaster);
    const [first, second] = text.split(/\s+/);
    const cmd = first.toLowerCase();

    if (cmd === '!nocast') return optOut(channel, st, login);
    if (cmd === '!lurk') return castLurker(channel, st, e, login);
    if (cmd === '!uncast') {
      if (!privileged) return { action: 'ignored', reason: 'permission' };
      const target = String(second || '').replace(/^@/, '').toLowerCase();
      if (!target) return { action: 'ignored', reason: 'target' };
      st.blocked.add(target);
      if (removeFromCast(channel, st, target)) { forgetAppearance(st, target); save(channel, st); }
      return { action: 'uncast', login: target };
    }
    if (cmd === '!newepisode') {
      if (!privileged) return { action: 'ignored', reason: 'permission' };
      return { action: 'newepisode', episode: startNewEpisode(channel) };
    }
    if (cmd === '!credits') {
      if (!privileged) return { action: 'ignored', reason: 'permission' };
      onCredits(channel);
      return { action: 'command', name: 'credits' };
    }
    if (text.startsWith('!')) return { action: 'ignored', reason: 'command' };
    if (hasLink(text)) return { action: 'ignored', reason: 'link' };
    return castChatter(channel, st, e, login, text);
  }

  return {
    async handleChat(e) {
      try { return await processChat(e); } catch (err) {
        log.error('Casting failed:', err.stack || err.message);
        return { action: 'error' };
      }
    },
    async handleRaid(e) {
      try {
        const channel = String(e.channel || '').toLowerCase();
        if (!isValidChannel(channel)) return { action: 'ignored', reason: 'channel' };
        const login = String(e.raiderLogin || '').toLowerCase();
        if (!login) return { action: 'ignored', reason: 'login' };
        const st = state(channel);
        const reason = skipReason(st, login, null);
        if (reason) return { action: 'ignored', reason };
        if (st.cast.size >= maxCast() + 10) return { action: 'ignored', reason: 'cap' }; // raids get a little extra room
        const n = Number(e.viewers) || 0;
        const logline = n > 1 ? `Arrived with ${n} friends in tow.` : 'Dropped in to say hello.';
        const entry = commit(channel, st, { login, name: cleanName(e.raiderName, login), kind: 'guest', role: 'The Special Guest', logline });
        return { action: 'cast', entry };
      } catch (err) {
        log.error('Raid casting failed:', err.stack || err.message);
        return { action: 'error' };
      }
    },
    getCast(channel) {
      const st = channels.get(channel);
      if (!st) return [];
      return [...st.cast.values()].sort((a, b) => Number(b.regular) - Number(a.regular));
    },
    getEpisode: (channel) => state(channel).episode,
    isPaused: (channel) => state(channel).paused,
    setPaused(channel, paused) { state(channel).paused = Boolean(paused); },
    uncast(channel, login) {
      const st = state(channel);
      const l = String(login).toLowerCase();
      st.blocked.add(l);
      const had = removeFromCast(channel, st, l);
      if (had) { forgetAppearance(st, l); save(channel, st); }
      return had;
    },
    startNewEpisode,
  };
}

module.exports = { createCastingEngine, hasLink, KNOWN_BOTS, LURK_ROLES };
