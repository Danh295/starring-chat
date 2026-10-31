# Sharing the overlay with a streamer (Cloudflare quick tunnel)

The server runs on your laptop. A streamer's OBS runs on theirs. A free Cloudflare quick tunnel gives your local server a public `https://...trycloudflare.com` address, with no account and no router changes.

1. Install `cloudflared` (`brew install cloudflared` on macOS, `winget install --id Cloudflare.cloudflared` on Windows).
2. Start the app: `npm start`.
3. In a second terminal: `npm run tunnel`. It prints your public URL.
4. Open `<public url>/setup.html`, type the streamer's channel name, and send them the overlay URL it shows. They paste it into an OBS Browser Source (1920x1080, "Control audio via OBS" on).

Notes:
- The URL changes every time the tunnel restarts. Streamers must update their Browser Source after a restart. (A named tunnel on a Cloudflare account keeps a fixed address; see Cloudflare's docs.)
- Pages and the overlay WebSocket both work over `https` (the overlay switches to `wss` automatically).
- Anyone with the URL can load an overlay for a channel and see its public cards. Nothing private is sent to overlays.
- Through the tunnel, `/auth` and the `/test/*` routes are closed. The control API always needs `CONTROL_PASSWORD` in the `x-control-password` header.
- Set a long, random `CONTROL_PASSWORD` before sharing a tunnel. Wrong guesses are rate limited per client.
- Stop the tunnel with Ctrl+C when you are done.
