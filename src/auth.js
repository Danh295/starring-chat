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
      fs.writeFileSync(tmp, JSON.stringify(tokens), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
    },
  };
}

// True only for requests made directly to this machine. A Cloudflare tunnel connects
// from localhost, so we also reject anything carrying proxy headers or a non-local Host.
function isLocalRequest(req) {
  const h = req.headers || {};
  if (h['cf-connecting-ip'] || h['x-forwarded-for'] || h.forwarded || h['x-real-ip']) return false;
  const host = String(h.host || '').replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function createTwitchAuth({ config, store, fetch = globalThis.fetch, now = Date.now }) {
  const redirectUri = `http://localhost:${config.port}/auth/callback`;
  const pendingStates = new Set();
  let refreshing = null;

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
    if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`);
    const data = await res.json();
    if (!data.access_token || !data.refresh_token) throw new Error('Twitch token response was incomplete');
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: now() + (Number(data.expires_in) || 0) * 1000,
    };
    store.save(tokens);
    return tokens;
  }

  function startLogin() {
    const state = crypto.randomBytes(16).toString('hex');
    if (pendingStates.size >= 20) pendingStates.delete(pendingStates.values().next().value);
    pendingStates.add(state);
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
    if (!state || !pendingStates.delete(state)) throw new Error('Unknown or expired login state');
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  function refresh() {
    if (!refreshing) {
      const saved = store.load();
      if (!saved || !saved.refresh_token) return Promise.reject(new Error('No saved tokens. Visit http://localhost:' + config.port + '/auth first.'));
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function getAccessToken() {
    const saved = store.load();
    if (!saved || !saved.access_token) throw new Error('No saved tokens. Visit http://localhost:' + config.port + '/auth first.');
    if (saved.expires_at - REFRESH_MARGIN_MS > now()) return saved.access_token;
    return (await refresh()).access_token;
  }

  // Calls the Helix API with the bot token. On a 401 it refreshes once and retries once.
  async function helix(pathAndQuery, options = {}) {
    const call = async (token) => fetch(`${HELIX}${pathAndQuery}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Client-Id': config.twitchClientId },
    });
    let res = await call(await getAccessToken());
    if (res.status === 401) res = await call((await refresh()).access_token);
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
