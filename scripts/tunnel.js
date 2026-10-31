'use strict';
// `npm run tunnel`: exposes the local server with a free Cloudflare quick tunnel
// and prints the public URLs a streamer needs.
require('dotenv').config();
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { loadConfig } = require('../src/config');
const { extractTunnelUrl, tunnelArgs, setupInstructions, INSTALL_HELP } = require('../src/tunnel');

const { port } = loadConfig();
if (process.env.PORT && String(port) !== String(process.env.PORT).trim()) {
  console.warn(`Warning: PORT="${process.env.PORT}" is not a valid port, so ${port} is used (the server does the same).`);
}

// Tell the user early if the app is not running, since the tunnel would only return errors.
fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
  .catch(() => console.warn(`Warning: nothing is answering on http://127.0.0.1:${port}. Start the app with "npm start" in another terminal.`));

const child = spawn('cloudflared', tunnelArgs(port), { stdio: ['ignore', 'pipe', 'pipe'] });

let lastUrl = null;
const onLine = (line) => {
  const url = extractTunnelUrl(line);
  if (url && url !== lastUrl) { // announce again if cloudflared hands out a new address
    lastUrl = url;
    console.log(setupInstructions(url));
  }
};
readline.createInterface({ input: child.stdout }).on('line', onLine);
readline.createInterface({ input: child.stderr }).on('line', onLine);

child.on('error', (err) => {
  if (err.code === 'ENOENT') console.error(INSTALL_HELP); else console.error('Could not start cloudflared:', err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal && !stopping) console.error(`cloudflared stopped unexpectedly (${signal}). The public URL no longer works.`);
  else if (code && !stopping) console.error(`cloudflared exited with code ${code}. The public URL no longer works.`);
  process.exit(stopping ? 0 : (code || (signal ? 1 : 0)));
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => { child.kill('SIGKILL'); process.exit(0); }, 4000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
console.log(`Starting a Cloudflare quick tunnel to http://127.0.0.1:${port} ...`);
