# 🎱 8-Ball Pool

A browser-based 8-ball pool game. One screen ("host table") shows the table; up to two players
join over the internet from their phones and shoot from there — the host can play too, right from
the big screen. Built with a custom deterministic physics engine, Three.js rendering, and a small
WebSocket relay that just forwards messages — the host's browser runs the table.

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

## Tables

A table theme is the whole venue, not a felt colour: cloth, rail stock, pocket leather, the metal
the sights and bezels are plated in, the lamp hanging over it, and the room it stands in — which
comes with its own drawn set, its own synthesized score and its own ambient bed.

Eleven ship, from the Classic Green pub table to the Velvet Room and the Emerald Vault. All of
them are assembled from the material catalogues in `render/cosmetics/materials.ts`, and so is
anything you build yourself: **Settings → Table → Design your own table** opens the Theme Studio,
where the same five choices are yours to make. Saved tables sit in the picker alongside the
shipped ones and are stored per-browser.

The materials are real rather than decorative. Cloth carries a thread pitch and a nap, so worsted
tournament cloth is visibly tighter than napped bar cloth; wood carries figure, pore and varnish,
so ebony comes out closed and mirror-finished where weathered teak comes out open and dry; metal
carries a highlight ramp, which is what makes chrome read as chrome next to brass. The cloth and
rail textures are generated per theme from those numbers (`render/surfaces.ts`) and cached, and
the picker's swatches and the Studio's live preview are the same table drawn small
(`render/tablePreview.ts`), so what you design is what you sit down at.

Behind the table there is no room at all — just graded darkness, a pool of light thrown down over
the table and the penumbra it casts past the rails (`render/cosmetics/scenes.ts`). Drawn rooms
came first and were the wrong idea: every chair and rug was another object competing with the one
thing a player actually reads. The backdrop is generated from the theme's own lamp and cloth, so a
table built in the Studio gets a backdrop that is genuinely its own.

Over that sits a moving layer — dust turning in the beam, snow and an aurora on Ice, embers under
a candle, a beam sweeping under a cold spot (`render/ambientFx.ts`), chosen by the theme's lamp.
It is drawn behind the table so it can never obscure a shot, and it is the first thing
**Reduce motion** switches off.

Potted balls go into a ball rack down the right-hand side: a board with fifteen turned cups, so
the gaps in it tell you how much of the frame is left.

## Cases

Keys open cases in the locker. The sequence is four beats — a closed case breathing light through
its seam, a shake and a burst, a reel of real items scrolling past a marker, then the prize rising
out of the strip it landed on (`profile/caseReel.ts`). Each beat is a class on the overlay, so the
CSS owns the choreography and the TypeScript owns the timing.

The prize itself is decided up front by `spendSpin`, before any of that runs — see
`shared/src/reel.ts` for why keeping the animation and the odds apart is load-bearing. The strip
you watch is drawn at the real rarity weights, and the cell just before the winner is deliberately
loaded with something better, which costs nothing and changes nothing about what you get. The odds
are stated permanently on the dialog as a weighted bar.

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

### Cloudflare (free, recommended)

`packages/worker` serves the built client as static assets and runs the relay as Durable Objects
from one Worker, all within Cloudflare's free plan, with no sleep or cold starts. Idle rooms
hibernate and cost nothing.

```bash
npx --prefix packages/worker wrangler login   # once per machine
npm run deploy                                # build, then publish to https://8ball-pool.<you>.workers.dev
```

### Any Node host

The Node server serves the built client as static files from the same process, so it also deploys
as a single Node web service — no separate static host or CORS setup needed. `render.yaml` is included
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
running, not the production build or the relay. Fixing it requires a breaking
Vite 8 upgrade, so it's left as-is for now.
