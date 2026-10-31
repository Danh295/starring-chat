# Twitch setup (one time)

1. Turn on two-factor authentication on your Twitch account (required for the developer console).
2. Open https://dev.twitch.tv/console/apps and click **Register Your Application**.
3. Name: anything unique (for example `starring-chat-yourname`). Category: **Chat Bot**. Client type: **Confidential**.
4. OAuth Redirect URL: exactly `http://localhost:3000/auth/callback` (change the port if you set `PORT`). Save.
5. Click **Manage**, copy the **Client ID**, and generate a **Client Secret**.
6. Copy `.env.example` to `.env` and set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `BOT_USERNAME` (the account that will read chat) and `CHANNELS`.
7. Run `npm start`, open http://localhost:3000/auth **while logged in as the bot account**, and approve. Tokens are saved to `data/tokens.json` (gitignored, owner-only permissions) and refresh automatically.

`/auth` only works when opened directly on `localhost`; it is blocked when reached through a tunnel.
