# AGENTS.md

Brief for any coding agent (Claude Code, Codex) working in this repo.

## Project
Starring: Chat is a Twitch overlay for the Codex x TwitchCon Hackathon. New chatters are cast as sitcom characters (AI-written role plus logline), `!lurk` gives a Background Extra card, raids give a Guest Star card, returning chatters become Series Regulars from their 3rd episode, and `!credits` rolls sitcom end credits.

## Rules
- Node >= 20, CommonJS, Express, ws, dotenv, openai. Plain HTML/CSS/JS overlays, no front-end framework, no database (JSON files in `data/`).
- Test-first with `node:test`. Run `npm test` (bare `node --test`). Every module takes its dependencies (fetch, WebSocket factory, OpenAI client, clock) as arguments so tests use fakes.
- Test seams: config, logger, HTTP routes, overlay WebSocket hub, EventSub client (against a fake local ws server), casting engine (public `handleChat` / `handleRaid`), credits builder, demo mode end to end.
- Never commit secrets. `.env` and `data/tokens.json` stay gitignored. Tokens never reach the browser.
- Chat text and model output are rendered with `textContent`, never `innerHTML`.
- The app must run in demo mode with no Twitch or OpenAI keys.
- Model-written roles are PG and never reference appearance, identity or other sensitive traits.
- No AI-generated images, no copyrighted music. Art lives in `public/art/`, audio in `public/audio/`.
- One branch and PR per ticket. Run a code review before merging.

## Process notes
The `setup-matt-pocock-skills` and `ask-matt` skills were not available in the build session, so seams were chosen by the agent (listed above).
