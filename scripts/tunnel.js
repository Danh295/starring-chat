'use strict';
// `npm run tunnel`: exposes the local server with a free Cloudflare quick tunnel
// and prints the public URLs a streamer needs.
require('dotenv').config();
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { loadConfig } = require('../src/config');
const { extractTunnelUrl, tunnelArgs, setupInstructions, INSTALL_HELP } = require('../src/tunnel');

const { port } = loadConfig();
const child = spawn('cloudflared', tunnelArgs(port), { stdio: ['ignore', 'pipe', 'pipe'] });

let announced = false;
const onLine = (line) => {
  if (!announced) {
    const url = extractTunnelUrl(line);
    if (url) { announced = true; console.log(setupInstructions(url)); }
  }
};
readline.createInterface({ input: child.stdout }).on('line', onLine);
readline.createInterface({ input: child.stderr }).on('line', onLine);

child.on('error', (err) => {
  if (err.code === 'ENOENT') console.error(INSTALL_HELP); else console.error('Could not start cloudflared:', err.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code || 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
console.log(`Starting a Cloudflare quick tunnel to http://localhost:${port} ... (is "npm start" running?)`);
