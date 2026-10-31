'use strict';

const URL_RE = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i;

// Finds the public quick-tunnel URL in a line of cloudflared output.
function extractTunnelUrl(line) {
  const m = URL_RE.exec(String(line || ''));
  if (!m || m[1].toLowerCase() === 'api') return null; // api.trycloudflare.com is cloudflared's own endpoint
  return m[0];
}

// Arguments for cloudflared (an array, never a shell string).
function tunnelArgs(port) {
  const p = String(port).trim();
  if (!/^\d{1,5}$/.test(p)) throw new Error(`Invalid port: ${port}`);
  return ['tunnel', '--url', `http://127.0.0.1:${p}`];
}

function setupInstructions(url) {
  return [
    '',
    'Your public tunnel is ready:',
    `  ${url}`,
    '',
    'Next:',
    `  1. Open ${url}/setup.html in your browser and type your channel name.`,
    '  2. Paste the overlay URL it gives you into OBS as a Browser Source.',
    `  3. Control room: ${url}/control.html (needs CONTROL_PASSWORD).`,
    '',
    'This URL changes every time the tunnel restarts, so update the OBS source if you restart it.',
    'Keep this window open while streaming. Press Ctrl+C to close the tunnel.',
    '',
  ].join('\n');
}

const INSTALL_HELP = [
  'cloudflared was not found. Install it, then run `npm run tunnel` again:',
  '  macOS:   brew install cloudflared',
  '  Windows: winget install --id Cloudflare.cloudflared',
  '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
].join('\n');

module.exports = { extractTunnelUrl, tunnelArgs, setupInstructions, INSTALL_HELP };
