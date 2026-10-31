'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const SCOPES = ['user:read:chat', 'user:write:chat'];
const ID_BASE = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const REFRESH_MARGIN_MS = 60_000;

// Saves tokens to <dir>/tokens.json with owner-only permissions (written atomically).
function createTokenStore(dir) {
  const file = path.join(dir, 'tokens.json');
  return {
    load() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    },
    save(tokens) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(tokens), { mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, file);
      } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
        throw err;
      }
    },
  };
}

// True only for requests made directly to this machine. A Cloudflare tunnel connects
// from localhost, so we also reject anything carrying proxy headers or a non-local Host.
function isLocalRequest(req) {
  const addr = req.socket && req.socket.remoteAddress;
  if (addr && !/^(127\.|::1$|::ffff:127\.)/.test(addr)) return false;
  const h = req.headers || {};
  if (h['cf-connecting-ip'] || h['x-forwarded-for'] || h.forwarded || h['x-real-ip']) return false;
  const host = String(h.host || '').replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function createTwitchAuth({ config, store, fetch = globalThis.fetch, now = Date.now }) {
  const redirectUri = `http://localhost:${config.port}/auth/callback`;
  const pendingStates = new Map(); // state -> created-at ms
  const STATE_TTL_MS = 10 * 60 * 1000;
  let refreshing = null;
  let memory = null; // latest tokens, so a failed disk save never loses a rotated refresh token
  const NEED_LOGIN = `Visit http://localhost:${config.port}/auth to log in again.`;

  function readTokens() { return memory || store.load(); }
  function remember(tokens) {
    memory = tokens;
    try { store.save(tokens); } catch (err) { console.error('Could not save tokens to disk:', err.message); }
  }

  async function tokenRequest(params) {
    const res = await fetch(`${ID_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.twitchClientId,
        client_secret: config.twitchClientSecret,
        ...params,
      }).toString(),
    });
    if (!res.ok) throw new Error(`Twitch token request failed (${res.status}). ${NEED_LOGIN}`);
    const data = await res.json();
    const refreshToken = data.refresh_token || params.refresh_token;
    if (!data.access_token || !refreshToken) throw new Error('Twitch token response was incomplete');
    return {
      access_token: data.access_token,
      refresh_token: refreshToken,
      expires_at: now() + (Number(data.expires_in) || 0) * 1000,
    };
  }

  // Confirms the token belongs to BOT_USERNAME (when set) so we never save the wrong account.
  async function checkAccount(accessToken) {
    if (!config.botUsername) return;
    const res = await fetch(`${ID_BASE}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
    const info = res.ok ? await res.json() : {};
    if (String(info.login || '').toLowerCase() !== config.botUsername) {
      throw new Error(`Logged in as the wrong account. Log in as ${config.botUsername} and try again.`);
    }
  }

  function startLogin() {
    const state = crypto.randomBytes(16).toString('hex');
    if (pendingStates.size >= 20) pendingStates.delete(pendingStates.values().next().value);
    pendingStates.set(state, now());
    const url = new URL(`${ID_BASE}/authorize`);
    url.search = new URLSearchParams({
      client_id: config.twitchClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
    }).toString();
    return { url: url.toString(), state };
  }

  async function completeLogin(code, state) {
    const created = pendingStates.get(state);
    pendingStates.delete(state);
    if (created === undefined || now() - created > STATE_TTL_MS) throw new Error('Unknown or expired login state');
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    await checkAccount(tokens.access_token);
    remember(tokens);
  }

  function refresh() {
    if (!refreshing) {
      const saved = readTokens();
      if (!saved || !saved.refresh_token) return Promise.reject(new Error(`No saved tokens. ${NEED_LOGIN}`));
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token })
        .then((tokens) => { remember(tokens); return tokens; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function getAccessToken() {
    const saved = readTokens();
    if (!saved || !saved.access_token) throw new Error(`No saved tokens. ${NEED_LOGIN}`);
    if (saved.expires_at - REFRESH_MARGIN_MS > now()) return saved.access_token;
    return (await refresh()).access_token;
  }

  // Calls the Helix API with the bot token. On a 401 it refreshes once and retries once.
  async function helix(pathAndQuery, options = {}) {
    const call = async (token) => fetch(`${HELIX}${pathAndQuery}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Client-Id': config.twitchClientId },
    });
    const used = await getAccessToken();
    let res = await call(used);
    if (res.status === 401) {
      // Another caller may already have refreshed; only refresh if the stored token is the one that failed.
      const latest = readTokens();
      const next = latest && latest.access_token !== used ? latest.access_token : (await refresh()).access_token;
      res = await call(next);
    }
    return res;
  }

  return { startLogin, completeLogin, getAccessToken, refresh, helix, redirectUri };
}

// /auth and /auth/callback. Only reachable directly on this machine, never via the tunnel.
function createAuthRouter({ auth, log }) {
  const router = express.Router();
  router.use((req, res, next) => (isLocalRequest(req) ? next() : res.status(403).send('Forbidden')));
  router.get('/', (_req, res) => res.redirect(auth.startLogin().url));
  router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (req.query.error) {
      return res.status(400).send('Login was cancelled or denied on Twitch. Start again at /auth.');
    }
    if (typeof code !== 'string' || typeof state !== 'string') return res.status(400).send('Missing code or state');
    try {
      await auth.completeLogin(code, state);
      res.type('html').send('<h1>Starring: Chat is connected to Twitch.</h1><p>You can close this tab.</p>');
    } catch (err) {
      if (log) log.warn('Twitch login failed:', err.message);
      res.status(400).send('Login failed. Start again at /auth.');
    }
  });
  return router;
}

module.exports = { createTokenStore, createTwitchAuth, createAuthRouter, isLocalRequest, SCOPES };
