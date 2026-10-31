# Research notes (checked 2026-10-31 against dev.twitch.tv and developers.openai.com)

## Twitch EventSub (WebSocket)
- Subscribe within **10 seconds** of `session_welcome` or the server closes the socket (code 4003).
- `keepalive_timeout_seconds` comes from the welcome message. No notification or keepalive within that time means the connection is dead: reconnect and resubscribe. Ping/pong does not reset the timer.
- `session_reconnect`: connect to `reconnect_url` exactly as given. Subscriptions carry over. Keep the old socket open until the new one sends `session_welcome`, then close the old one. Otherwise close code 4004.
- Limits: 300 enabled subscriptions per connection, 3 connections per user token, `max_total_cost` 10.
- `channel.chat.message` and `channel.chat.notification`: version `1`, condition `broadcaster_user_id` + `user_id` (the bot). With a **user token** the scope is `user:read:chat` (the bot account's token). Sending chat needs `user:write:chat`.
- Raids arrive as `channel.chat.notification` with `notice_type: "raid"` (or `"shared_chat_raid"`). The `raid` object has `user_id`, `user_login`, `user_name`, `viewer_count`.
- The separate `channel.raid` event names the count `viewers`, not `viewer_count`, and needs no auth. We use the chat notification so one connection covers everything.
- Chat message events: `chatter_user_id`, `chatter_user_login`, `message.text`, `badges[].set_id`. Broadcaster is detected by comparing `chatter_user_id` with `broadcaster_user_id`; mods by a `moderator` badge.

## OpenAI
- Responses API structured output: `text.format = { type: "json_schema", name, strict: true, schema }`, read `response.output_text`. Handle `refusal` content and `status: "incomplete"`.
- Moderation: `POST /v1/moderations`, model `omni-moderation-latest`, check `results[0].flagged`.
- The SDK retries twice by default, so build the client with `maxRetries: 0` and race a 3 second timer to honour the casting budget.
- `new OpenAI()` throws without a key, so the client is constructed lazily.

## Corrections to the original plan
- Node 20 is the minimum, but the dev machine runs Node 25. `npm test` is bare `node --test` because directory and glob args behave differently across versions.
- `/auth` and `/test/*` must not rely on `req.ip` being localhost: a Cloudflare tunnel connects from localhost. Gate on absence of `cf-connecting-ip` / `x-forwarded-for` and a localhost `Host` header.
- The 8 second card limit queues cards rather than dropping them, so every cast member still reaches the credits.
