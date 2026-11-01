# Frontend rebuild plan

Planned with Hallmark (v2.0.0), executed iteratively with a kill-ai-slop pass and a Hallmark lint after every stage. The old frontend was removed first (commit "remove the entire frontend"); this plan rebuilds it from nothing.

## What is kept, what is rebuilt

- **Kept (not UI):** the server contract (routes, the overlay WebSocket events, the control API, `/art-manifest`) and three tested logic modules: `public/overlay-core.js` (card model, queue, credits model), `public/control-core.js` (two-step confirm, grouping, URL state), `public/setup-core.js` (channel check, URL, clipboard).
- **Rebuilt:** every page, stylesheet, rendering script and screenshot.

## Who uses it, and for what

| Surface | Person | Job |
| --- | --- | --- |
| Stream card and credits | A viewer, often on a phone | Know in three seconds who just showed up and what their role is |
| Setup page | A streamer, first visit, not technical | Get the overlay into OBS and know it works |
| Control room | The streamer, live, often one-handed on a phone | Run the show without hesitation |

## Hallmark picks

- **Scope:** app screens (setup, control) plus two stream surfaces (the card, the credits). No hero, no fold, no section rhythm.
- **Theme:** Wayfind, dealt 1 of 3 (seed `dark-technical-tool-small-ecf1·7e034184·2026-11-01·r0`), colourway `night`. Public signage set as a tool: square 2px borders, Chivo Mono throughout (mono is the material), plates that each hold one instruction.
- **Signal:** Twitch violet takes the place of Wayfind's cobalt ("what is live"), because the brief says Twitch and a live show is exactly what that colour means. Amber marks figures only.
- **Tier colours** (cast, series regular, special guest star, background extra) are Wayfind's "network line colours": small squares, never a fill or a gradient.
- **Signature, setup:** the route. The four steps are stops on one line, each a plate holding a single instruction; the line shows where you are.
- **Signature, control:** the cast board. Tonight's cast as a departures board: a line square, a name, a role, and one action per row.
- **Signature, stream:** the card is a sign plate, a coloured line square with the initial, the role as the instruction.
- **Controls:** a violet-filled primary beside square outlined secondaries, 44px minimum. Casting is a two-cell choice (On, Paused), not a toggle, so the state is readable without learning a switch.
- **Feedback:** no toasts. Every action reports its result in one status line beside the control that caused it.
- **States:** the cast loads (skeleton rows), is empty (what to do), fails (what broke, a retry), and is full.
- **State in the URL:** channel and filter.
- **Motion:** departure-board stiff: colour steps, rows update in place, nothing loops. Reduced motion honoured.

## Order of work (each stage ends with the Hallmark lint, the kill-ai-slop scan and a look at the render)

1. Tokens and base (scaffolded from the theme, night colourway, violet signal).
2. The stream card and the overlay page.
3. The setup page.
4. The control room.
5. The credits.
6. Screenshots, README, an accessibility audit, tests, review, merge.
