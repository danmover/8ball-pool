# 8-Ball Pool v2 — overhaul brief

The working brief for the v2 rebuild. It is written as instructions, because it is the prompt the
rebuild was executed from.

## Goal

Rebuild everything around the physics engine so the game is better to look at, better to play and
free to host: a 3D table, fewer modes that each play well, a small locker where every item looks
different, bots with personality, and friends able to play together from any network. Offline play
against bots needs no server at all.

## Non-negotiables

1. **Keep the physics.** `physics.ts`, `table.ts`, `trajectory.ts` and the rack builders are
   correct and well tested. Change them only to make them deterministic across browsers
   (no `Math.hypot`; `+ - * /` and `Math.sqrt` only inside the simulation step).
2. **Keep the host table.** One device (TV or laptop) can host a room that everyone else joins
   by code or QR. The host can play as well, or act only as the display.
3. **Free to run.** No paid services. The client is static files. The only server is a small
   relay that forwards messages; it runs free on Cloudflare Workers + Durable Objects, and the
   same relay also runs as a plain Node server for local, LAN, Render or any Node host.
4. **Offline first.** Playing bots, practice, time attack and trick shots work with no network
   (a PWA with a service worker). Online features switch off cleanly when offline.
5. **Everything verified.** Unit tests for engine, rules, bots and relay; a Playwright run that
   plays real frames offline and across two browser contexts through the relay; screenshots of
   every screen at desktop and phone sizes.

## Architecture

```
packages/shared   physics, rules, modes, TableSession (the game host engine), bots,
                  protocol, cosmetics catalogue, economy, missions, cups, relay routing
packages/client   Vite + Preact + Three.js. Host and client controllers, 3D renderer, UI
packages/server   Node relay (ws) + static file server — dev, LAN and Node hosting
packages/worker   Cloudflare Worker: static assets + Durable Object relay — free production
```

### Host-authoritative sessions

- `TableSession` (shared) owns a room: members, seats, settings, the frame, match score,
  tournament, bots and turn timing. It never touches a socket; it gets a `send(to, msg)`
  callback and receives `receive(peer, msg)`. The host device runs it.
- Transports: `LocalTransport` (in-page, offline) and `RelayTransport` (WebSocket to relay).
  The host's own UI is a peer on the local loopback, so there is one code path for everyone.
- **Deterministic shots.** When a shot is taken the host snapshots the balls, applies the
  strike, simulates to rest at a fixed step, resolves the rules, then sends one `shot` message:
  `{pre, strike, steps, result}`. Every device (host included) replays the same simulation
  locally at display rate and applies `result` when playback ends. Any float drift is corrected
  by `result`'s authoritative ball positions. Aim is streamed at ~15 Hz.
- Hosts persist the session to `sessionStorage` after every settled shot, so a reload resumes.
- Bots run on the host (in a Web Worker in the browser) through an injected `BotRunner`.

### Relay protocol

- Host: `GET /ws/host?code=&key=` — relay assigns a code when none is given; `key` lets the
  host reconnect within a grace period. Host sends `{to, d}`; receives `{from, d}` and
  `{sys:'join'|'leave', peer}`.
- Client: `GET /ws/join?code=&peer=` — sends raw messages; receives raw host messages and
  `{sys:'host-away'|'host-back'|'closed'}`.
- `GET /api/rooms` lists public rooms (host opts in, relay keeps metadata only).

## Game design

### Modes (11 → 4 multiplayer + 3 solo)

| Mode | Players | Summary |
|---|---|---|
| 8-Ball | 2 or 2v2 | Solids/stripes, call the pocket on the 8. Standard or Pro rules. |
| 9-Ball | 2–4 | Lowest first, the 9 wins, combos count. |
| Killer | 2–8 | Three lives, pot every visit or lose one, the black gives a life back. |
| Power Pool | 2–4 | Points race with power orbs on the cloth: Big Pockets, Bomb, Double, Guide+, Extra Shot, Freeze. |
| Practice | solo | Free table, undo, re-rack, place the cue ball anywhere. |
| Time Attack | solo | Clear 15 against the clock; fouls add time; star ratings and best times. |
| Trick Shots | solo | The existing 33 puzzles, re-presented. |

Rules presets drop from three to two: **Standard** (call the 8 only, ball in hand anywhere)
and **Pro** (call every shot, break rule, kitchen after a break scratch, three fouls).

### Engagement

- Shot feedback: combos, runs, bank/kick pots, clearances, "perfect position", big clean-win
  finishes with a slow-motion replay of the winning ball.
- Shot clock ring on the player card, streak flames, emotes and quick chat.
- XP, levels, coins, three daily missions, a login streak, and cups against bots.
- Every match ends on a results screen with stats, rewards and a rematch button.

### Bots

Twelve personalities across four tiers (Rookie, Amateur, Pro, Master), each with a name, avatar,
play style (aggressive, safety player, show-off) and chat lines. The brain proposes direct pots,
banks and combos, simulates them with the real engine, scores the outcome including where the cue
ball finishes and what it leaves the opponent, plays safeties when nothing is on, and misses like a
person through contact-point error. Its cue sweeps and charges on screen like a human's.

### Tournaments and lobbies

- **Rooms**: create, share the code/QR/link, seats with avatars and ready states, host settings
  (mode, rules, race-to, shot clock, aim guide, public/private), add or remove bots, kick, move
  seats, spectators, emotes. Formats: Match, Tournament (4 or 8, bots fill), Winner Stays On.
- **Tournaments**: bracket screen with animated progression, match intros, bot-vs-bot matches
  auto-resolved by skill, trophy ceremony.
- **Cups** (offline): a ladder of 8-player knockouts against bot tiers; winning unlocks the next
  cup and exclusive items. Replaces the old career.

### Locker (8 slots / ~130 items → 4 slots / 32 items)

Cues, Ball Sets, Tables and Shot FX, eight each, every one visibly distinct in the 3D renderer.
Items are bought with coins or unlocked by levels and cups — no random cases. Avatars are an
emoji and a colour, free. The room uses the host's table.

## Presentation

- **Three.js table**: PBR cloth with nap texture, extruded cushions and jaws built from the
  physics geometry, wood rails with diamonds, deep pockets that balls drop into, lamp lighting,
  environment reflections, clear-coated balls with proper rolling rotation from the physics'
  angular velocity, 3D cue, guide lines, trails, particles. Top-down camera by default, rotated for
  portrait phones, optional 3D tilt.
- **Table HUD**: player cards with remaining-ball chips and a clock ring across the top; a pull-back
  power cue on the left; a glass **ball return** on the right that potted balls roll into; a small
  dock at the bottom for spin, shot type and fine aim; notices in the centre.
- **Menus**: dark premium pool-hall look — glass panels, gold accent, bold Outfit type, a live 3D
  bot-vs-bot frame playing behind the home screen. Built with Preact components.
- Fonts bundled locally (offline). Synthesised audio kept and tuned.

## Execution order

1. Shared: determinism, modes, cosmetics, economy, missions, cups, bots, `TableSession`,
   protocol, relay routing. Tests.
2. Relay: Node server (`ws`) and Cloudflare Worker. Tests.
3. Client foundation: Preact app shell, design system, profile/settings state, transports,
   host/client controllers, shot playback.
4. Three.js renderer.
5. Table screen and HUD, results, lobby, home, play flows, locker, cups, solo, missions, stats,
   settings, audio.
6. PWA/offline, deploy config, README.
7. End-to-end verification with Playwright; screenshot review at desktop and phone sizes; fix and
   polish until it holds up.
