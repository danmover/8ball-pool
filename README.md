# 🎱 8-Ball Pool

A browser-based 8-ball pool game. One screen ("host table") shows the table; up to two players
join over the internet from their phones and shoot from there — the host can play too, right from
the big screen. Built with a custom physics engine, PixiJS rendering, and Socket.IO for real-time
sync.

## How it works

- Open the site on a laptop/TV and tap **Host a Table**. You get a room code and a QR code.
- Players scan the QR (or type the code at `/`) on their phones to join as Player 1 / Player 2.
- The host can also claim a seat itself ("Play as Player 1/2") and shoot directly from the host
  screen with mouse/touch — handy for one person hosting solo against a friend on their phone.
- Whoever's shooting drags to aim (drag away from where you want to shoot, like pulling back a cue
  — release to fire) and can add side-spin with the small spin pad.
- A settings panel (⚙, available on both the host screen and each phone independently) includes an
  **aim guide** with three levels — Off, Basic (straight line), Full (cushion-bounce-aware line +
  ghost ball + predicted object-ball path) — plus sound, vibration, colorblind ball patterns, and a
  left-handed layout toggle.

## Project layout

```
packages/
  shared/   physics engine, 8-ball rules engine, shared types — used by both server and client
  server/   Express + Socket.IO room/game server (authoritative physics)
  client/   Vite + TypeScript + PixiJS front end (landing / host table / phone controller)
```

The physics and trajectory-prediction code is **shared** between server and client: the server
runs it authoritatively, and the client runs the exact same math locally so the aim-guide line
updates instantly while you drag, with no network round-trip.

## Local development

Requires Node 20+.

```bash
npm install
npm run dev
```

This builds `shared` once, then runs the server (`:8787`) and the Vite dev server (`:5173`)
together. Open `http://localhost:5173`. To try the full multiplayer flow locally, open the host
page in one tab and the join link in one or two others (or on your phone, if it's on the same
network — use your machine's LAN IP instead of `localhost`).

Run the shared package's physics/rules tests with:

```bash
npm test
```

## Production build

```bash
npm run build   # builds shared -> client -> server
npm start        # serves the built client and the game server from one Node process on $PORT
```

## Deploying

The server serves the built client as static files from the same process, so it deploys as a
single Node web service — no separate static host or CORS setup needed. `render.yaml` is included
for [Render](https://render.com): connect the repo, and it will run `npm install && npm run build`
then `npm start`, exposing `/healthz` for the health check. Railway, Fly.io, or any other Node
hosting service work the same way (build command `npm run build`, start command `npm start`,
respecting `$PORT`).

## Known v1 simplifications

- Standard 2-player 8-ball only (call-shot is not enforced — any legal pot counts); doubles/4-player
  isn't implemented.
- Side-spin affects cushion rebounds; top/back-spin (draw/follow) isn't simulated yet.
- Rolling friction is a single-phase model rather than a separate slide/roll transition.
- If the host's browser tab is closed or reloaded, it can rejoin the same table (a host token is
  stored locally for that purpose), but there's no support for hosting the same table from a
  different device.
- Sound effects are synthesized with the Web Audio API rather than recorded samples, to keep the
  repo self-contained and license-free.

## Known dev-tooling advisory

`npm audit` flags a moderate advisory in `esbuild`/`vite`'s dev server (GHSA-67mh-4wv8-2f99) — it
only affects the local Vite dev server accepting requests from other sites while `npm run dev` is
running, not the production build or the Express/Socket.IO server. Fixing it requires a breaking
Vite 8 upgrade, so it's left as-is for now.
