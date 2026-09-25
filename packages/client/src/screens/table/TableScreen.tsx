import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import {
  CUE_BALL_ID,
  TABLE_LENGTH,
  ballSetStyle,
  botById,
  callRequirement,
  challengeById,
  CHALLENGES,
  computeTrajectoryPreview,
  cueStyle,
  emoteText,
  fxStyle,
  legalTargetBallIds,
  modeDescriptor,
  seatIndex,
  tableStyle,
  type GameState,
  type RoomView,
  type ShotPlayback,
} from '@8ball/shared';
import { TableView } from '../../render/TableView';
import { ShotPlayer } from '../../game/shotPlayer';
import { AimControls } from '../../game/controls';
import { emptyTally, shotFeedback, type Notice, type ShotTally } from '../../game/feedback';
import type { ActiveSession } from '../../net/session';
import { settings, haptic } from '../../state/settings';
import { profile, recordMatch, recordSolo, type RewardSummary } from '../../state/profile';
import * as sfx from '../../audio/sfx';
import { stopMusic } from '../../audio/music';
import { IconButton, toast } from '../../ui/kit';
import { BallReturn, Dock, EmotePanel, MatchStatus, PlayerCard, PowerBar, SEAT_COLORS, SoloStatus, SpinPicker, useTicker, type HudLayout } from './hud';
import { Bubbles, Intermission, Notices, Results, type Bubble, type ShownNotice } from './overlays';
import { TableMenu } from './TableMenu';

let noticeId = 0;
let bubbleId = 0;

/** Seat indices this device has already been paid out for, keyed per result, so rewards land once. */
const rewarded = new Set<string>();

export function TableScreen({ session, onLeave }: { session: ActiveSession; onLeave: () => void }): JSX.Element | null {
  const client = session.client;
  const room = client.room.value;
  const game = client.game.value;
  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TableView | null>(null);
  const controls = useMemo(() => new AimControls(client), [client]);
  const [notices, setNotices] = useState<ShownNotice[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [potted, setPotted] = useState<number[]>([]);
  const [spinOpen, setSpinOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [layout, setLayout] = useState<HudLayout>('wide');
  const portrait = layout === 'tall';
  const tally = useRef<ShotTally>(emptyTally());
  const lastState = useRef<GameState | null>(null);

  const pushNotice = (n: Notice) => {
    const item = { ...n, id: ++noticeId };
    setNotices((list) => [...list.slice(-2), item]);
    setTimeout(() => setNotices((list) => list.filter((x) => x.id !== item.id)), n.tone === 'turn' ? 1500 : 2300);
  };
  const pushBubble = (b: Omit<Bubble, 'id'>) => {
    const item = { ...b, id: ++bubbleId };
    setBubbles((list) => [...list.slice(-3), item]);
    setTimeout(() => setBubbles((list) => list.filter((x) => x.id !== item.id)), 3200);
  };

  // ---------------------------------------------------------------- the renderer
  useEffect(() => {
    stopMusic();
    const r = client.room.value;
    const shooterSeat = (g: GameState | null) => (g && r ? r.seats[seatIndex(g.currentShooter)] : null);
    const s = settings.value;
    const view = new TableView(hostRef.current!, {
      quality: s.quality,
      table: tableStyle(r?.table),
      balls: ballSetStyle(r?.balls),
      cue: cueStyle(shooterSeat(client.game.value)?.loadout.cue),
      fx: fxStyle(shooterSeat(client.game.value)?.loadout.fx),
      effects: s.effects && !s.reduceMotion,
      tilt: s.tiltCamera,
    });
    viewRef.current = view;
    const g = client.game.value;
    if (g) {
      view.setBalls(g.balls);
      setPotted(g.balls.filter((b) => b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id));
    }
    (window as unknown as { __table: unknown }).__table = { view, controls, client, session };
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [client]);

  // Skins follow the room (the host's table and balls) and the shooter (their cue and effects).
  useEffect(
    () =>
      effect(() => {
        const r = client.room.value;
        const g = client.game.value;
        const view = viewRef.current;
        if (!view || !r) return;
        view.setTable(tableStyle(r.table), settings.value.quality);
        view.setBallSet(ballSetStyle(r.balls));
        if (g) {
          const seat = r.seats[seatIndex(g.currentShooter)];
          view.setCueStyle(cueStyle(seat?.loadout.cue));
        }
        view.setTilt(settings.value.tiltCamera);
        view.setEffectsEnabled(settings.value.effects && !settings.value.reduceMotion);
      }),
    [client]
  );

  // HUD insets frame the table in whatever space the overlays leave. A portrait screen stacks
  // the controls under the table; a short landscape one moves them to the sides, where there is
  // room to spare, so the table keeps as much height as it can.
  useEffect(() => {
    const measure = () => {
      const view = viewRef.current;
      const hud = hudRef.current;
      if (!view || !hud) return;
      const box = hud.getBoundingClientRect();
      const q = (sel: string) => hud.querySelector<HTMLElement>(sel)?.getBoundingClientRect();
      const top = q('.hud-top');
      const left = q('.hud-left');
      const right = q('.hud-right');
      const bottom = q('.hud-bottom');
      setLayout(box.height > box.width * 1.05 ? 'tall' : box.height < 540 ? 'short' : 'wide');
      const insets = {
        top: top ? top.bottom - box.top + 6 : 0,
        left: left && left.width > 0 ? left.right - box.left + 8 : 8,
        right: right && right.width > 0 ? box.right - right.left + 8 : 8,
        bottom: bottom && bottom.height > 0 ? box.bottom - bottom.top + 6 : 8,
      };
      view.setInsets(insets);
      // Pop-over panels open just above whatever sits under the table.
      hud.style.setProperty('--hud-bottom-h', `${Math.round(insets.bottom)}px`);
    };
    const ro = new ResizeObserver(measure);
    if (hudRef.current) {
      ro.observe(hudRef.current);
      hudRef.current.querySelectorAll('.hud-top, .hud-left, .hud-right, .hud-bottom').forEach((el) => ro.observe(el));
    }
    measure();
    const t = setTimeout(measure, 120);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [room?.phase, !!game, layout]);

  // ---------------------------------------------------------------- messages from the table
  useEffect(() => {
    const offs = [
      client.events.on('shot', (shot) => playShot(shot)),
      client.events.on('aim', ({ seat, aim }) => {
        const view = viewRef.current;
        const g = client.game.value;
        if (!view || !g || client.playing.value) return;
        const idx = seatIndex(seat);
        if (client.mySeats.value.includes(idx) && client.myTurn.value) return;
        const cue = g.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
        if (!cue) return;
        view.setAim({ from: cue.pos, angle: aim.angle, power: aim.power, elevation: aim.elevation }, true);
        othersGuide(aim.angle, aim.spin, aim.elevation, aim.power);
      }),
      client.events.on('place', ({ seat, pos }) => {
        const idx = seatIndex(seat);
        if (client.mySeats.value.includes(idx) && client.myTurn.value) return;
        viewRef.current?.setPlacement(pos, true);
        viewRef.current?.setAim(null);
      }),
      client.events.on('emote', (e) => {
        const text = emoteText(e.id);
        pushBubble({ seat: e.seat, name: e.name, text, emoji: e.id.startsWith('e:') });
        sfx.pop();
      }),
      client.events.on('say', (e) => {
        const seat = client.room.value?.seats[e.seat];
        pushBubble({ seat: e.seat, name: seat?.name ?? 'Bot', text: e.text, emoji: false });
      }),
      client.events.on('notice', (n) => toast(n.text, n.tone === 'bad' ? 'bad' : n.tone === 'good' ? 'good' : 'info')),
      client.events.on('error', (m) => toast(m, 'bad')),
      client.events.on('shotDone', (shot) => afterShot(shot)),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);

  let othersTimer: ReturnType<typeof setTimeout> | null = null;
  function othersGuide(angle: number, spin: { x: number; y: number }, elevation: number, power: number): void {
    if (othersTimer) return;
    othersTimer = setTimeout(() => {
      othersTimer = null;
      const view = viewRef.current;
      const g = client.game.value;
      const r = client.room.value;
      if (!view || !g || !r || r.settings.guide === 'off' || client.playing.value) return;
      const preview = computeTrajectoryPreview(g.balls, CUE_BALL_ID, angle, 'full', spin, Math.max(0.3, power), elevation);
      view.setGuide(preview, 'short');
    }, 80);
  }

  function playShot(shot: ShotPlayback): void {
    const view = viewRef.current;
    const r = client.room.value;
    lastState.current = client.game.value;
    if (!view) return;
    client.claimShot(shot.id);
    const seat = r?.seats[seatIndex(shot.seat)];
    view.setCueStyle(cueStyle(seat?.loadout.cue));
    view.setFx(fxStyle(seat?.loadout.fx));
    view.setPlacement(null);
    view.setGuide(null);
    view.setTargets([], []);
    view.setPockets(false, null);
    const cue = shot.pre.find((b) => b.id === CUE_BALL_ID);
    if (cue) {
      view.setAim({ from: cue.pos, angle: shot.input.angle, power: Math.max(0.15, shot.input.power), elevation: shot.input.elevation });
      view.strike();
    }
    sfx.cueStrike(shot.input.power);
    if (shot.strike.miscued) sfx.miscue();
    if (shot.input.power > 0.85) view.kick(0.15);
    haptic(Math.round(10 + shot.input.power * 25));
    const player = new ShotPlayer(shot);
    const pan = (x: number) => (portrait ? 0 : (x / TABLE_LENGTH) * 1.6 - 0.8);
    let pots = 0;
    view.play(
      player,
      (ev) => {
        if (ev.type === 'ballCollision') sfx.ballHit(ev.impulse, pan(ev.pos.x));
        else if (ev.type === 'cushion') sfx.cushion(ev.speed, pan(ev.pos.x));
        else if (ev.type === 'pot') {
          sfx.pocket(pan(ev.pos.x));
          if (ev.ballId !== CUE_BALL_ID) {
            pots++;
            if (pots >= 2) sfx.combo(pots);
            setPotted((list) => (list.includes(ev.ballId) ? list : [...list, ev.ballId]));
            haptic(18);
          }
        } else if (ev.type === 'bomb') {
          sfx.bomb();
          haptic([30, 30, 60]);
        } else if (ev.type === 'orb') sfx.orb();
        else if (ev.type === 'land') sfx.cushion(1200, pan(ev.pos.x));
      },
      () => client.finishShot(shot.id)
    );
  }

  function afterShot(shot: ShotPlayback): void {
    const r = client.room.value;
    const { notices: list, tally: t } = shotFeedback(shot, lastState.current, r, client.mySeats.value);
    for (const n of list) pushNotice(n);
    if (list.some((n) => n.tone === 'bad')) sfx.foul();
    if (t) {
      tally.current.multiPots += t.multiPots;
      tally.current.kickPots += t.kickPots;
      tally.current.jumpPots += t.jumpPots;
      tally.current.orbs += t.orbs;
    }
    controls.awaitingShot.value = false;
  }

  // ---------------------------------------------------------------- the settled table
  useEffect(
    () =>
      effect(() => {
        const g = client.game.value;
        const view = viewRef.current;
        if (!g || !view || client.playing.value) return;
        view.setBalls(g.balls);
        view.setOrbs(g.power?.orbs ?? null);
        const inFrame = new Set(g.balls.filter((b) => b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id));
        // Re-racks and new frames clear the return; late joiners pick up what is already down.
        setPotted((list) => {
          const kept = list.filter((id) => inFrame.has(id));
          for (const id of [...inFrame].sort((a, b) => a - b)) if (!kept.includes(id)) kept.push(id);
          return kept;
        });
        const awaiting = ['aiming', 'break', 'ball_in_hand'].includes(g.phase);
        view.setTargets(awaiting ? legalTargetBallIds(g) : [], g.balls);
        if (!client.myTurn.value) {
          view.setPockets(false, null);
          if (g.phase !== 'ball_in_hand') view.setPlacement(null);
        }
      }),
    [client]
  );

  // A new turn for this device.
  useEffect(() => {
    let was = client.myTurn.value;
    if (was) setTimeout(() => controls.resetForTurn(), 0);
    return client.myTurn.subscribe((now) => {
      if (now && !was) {
        controls.resetForTurn();
        sfx.turn();
        haptic([20, 40, 20]);
      }
      if (!now) {
        setSpinOpen(false);
        controls.cancelCharge();
      }
      was = now;
    });
  }, [client]);

  // This device's aim drives the cue and the guide.
  useEffect(
    () =>
      effect(() => {
        const view = viewRef.current;
        const g = client.game.value;
        const my = client.myTurn.value;
        const angle = controls.angle.value;
        const power = controls.power.value;
        const elevation = controls.elevation.value;
        const placing = controls.placing.value;
        const preview = controls.preview.value;
        const called = controls.calledPocket.value;
        void controls.spin.value;
        if (!view || !g || !my || client.playing.value) return;
        const cue = g.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
        view.setPlacement(placing, controls.placeValid.value);
        if (placing || g.phase === 'ball_in_hand' || !cue) {
          view.setAim(null);
          view.setGuide(null);
          if (!placing && g.phase === 'ball_in_hand' && cue) view.setPlacement(cue.pos, true);
          return;
        }
        view.setAim({ from: cue.pos, angle, power, elevation });
        const r = client.room.value;
        const pref = settings.value.guide;
        const table = r?.settings.guide ?? 'full';
        const frozen = g.power?.frozen.includes(g.currentShooter);
        const long = g.power?.armed === 'guide';
        let level: 'full' | 'short' | 'off' = pref === 'off' || table === 'off' ? 'off' : pref === 'short' || table === 'short' ? 'short' : 'full';
        if (frozen) level = 'off';
        if (long) level = 'full';
        view.setGuide(level === 'off' ? null : preview, level === 'off' ? 'full' : level);
        const need = callRequirement(g);
        view.setPockets(need !== 'none', need !== 'none' ? called : null);
      }),
    [client]
  );

  // Rewards, once, when a match finishes.
  useEffect(
    () =>
      effect(() => {
        const r = client.room.value;
        if (!r || r.phase !== 'results' || !r.result) return;
        const mine = client.mySeats.value;
        const key = `${r.code ?? 'local'}|${r.match?.frame}|${JSON.stringify(r.result.standings.map((s) => [s.seat, s.wins, s.stats.pots, s.stats.shots]))}|${r.result.solo?.stars}|${r.result.solo?.timeMs}`;
        if (rewarded.has(key)) return;
        const result = r.result;
        const desc = modeDescriptor(r.settings.mode);
        if (desc.solo && result.solo) {
          rewarded.add(key);
          const stats = result.standings[0]?.stats;
          const s = recordSolo({
            kind: result.solo.timeMs !== null ? 'time' : r.settings.mode === 'trickshot' ? 'trick' : 'time',
            challengeId: result.solo.challengeId,
            stars: result.solo.failed ? 0 : result.solo.stars,
            timeMs: result.solo.failed ? null : result.solo.timeMs,
            pots: stats?.pots ?? 0,
          });
          if (r.settings.mode !== 'practice') setRewards(s);
          if (!result.solo.failed) sfx.win();
          else sfx.lose();
          return;
        }
        const me = result.standings.find((s) => mine.includes(s.seat));
        if (!me) return;
        rewarded.add(key);
        const opponents = r.seats.filter((s) => s && !mine.includes(s.index));
        const tiers = opponents.map((s) => (s?.botId ? botById(s.botId)?.tier : null)).filter(Boolean) as ('rookie' | 'amateur' | 'pro' | 'master')[];
        const order = ['rookie', 'amateur', 'pro', 'master'];
        const botTier = tiers.length ? tiers.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] : null;
        const won = result.winners.some((w) => mine.includes(w)) || (result.champion !== null && mine.includes(result.champion));
        const summary = recordMatch({
          mode: r.settings.mode,
          won,
          botTier,
          versusHumans: opponents.some((s) => s?.kind === 'human' && s.peer !== client.me),
          raceTo: r.settings.raceTo,
          stats: me.stats,
          ...tally.current,
          cupId: session.cupId,
          champion: result.champion !== null && mine.includes(result.champion),
        });
        tally.current = emptyTally();
        setRewards(summary);
        if (won) sfx.win();
        else sfx.lose();
        if (summary.progression.levelAfter > summary.progression.levelBefore) setTimeout(() => sfx.levelUp(), 1400);
        setTimeout(() => sfx.coins(8), 700);
      }),
    [client]
  );

  // Clear the reward card when a new match starts.
  useEffect(() => {
    if (room?.phase === 'playing' && room.match?.frame === 1) setRewards(null);
  }, [room?.phase, room?.match?.frame]);

  // ---------------------------------------------------------------- input
  useEffect(() => {
    const el = hostRef.current!;
    const view = () => viewRef.current;
    const down = (e: PointerEvent) => {
      const v = view();
      if (!v) return;
      unlock();
      setSpinOpen(false);
      setEmoteOpen(false);
      if (client.playing.value) {
        v.hurry();
        return;
      }
      if (!client.myTurn.value) return;
      const g = client.game.value;
      if (g && callRequirement(g) !== 'none' && g.phase === 'aiming') {
        const pocket = v.pocketAt(e.clientX, e.clientY);
        if (pocket !== null) {
          controls.choosePocket(pocket);
          sfx.uiTap();
          haptic(10);
          return;
        }
      }
      const p = v.pick(e.clientX, e.clientY);
      if (!p) return;
      el.setPointerCapture(e.pointerId);
      controls.pointerDown(p);
    };
    const move = (e: PointerEvent) => {
      if (!controls.dragging) return;
      const p = viewRef.current?.pick(e.clientX, e.clientY);
      if (p) controls.pointerMove(p);
    };
    const up = () => controls.pointerUp();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!client.myTurn.value) return;
      const fine = e.shiftKey ? 0.0006 : e.ctrlKey || e.metaKey ? 0.03 : 0.0045;
      if (e.key === 'ArrowLeft' || e.key === 'a') controls.nudge(-fine);
      else if (e.key === 'ArrowRight' || e.key === 'd') controls.nudge(fine);
      else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        controls.keyChargeStart();
      } else if (e.key === '1') controls.setShotType('normal');
      else if (e.key === '2') controls.setShotType('swerve');
      else if (e.key === '3') controls.setShotType('jump');
      else if (e.key === 's') setSpinOpen((o) => !o);
      else if (e.key === 'Escape') controls.cancelCharge();
      else return;
      e.preventDefault();
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') controls.keyChargeEnd();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
      controls.dispose();
    };
  }, [client]);

  // ---------------------------------------------------------------- render
  const clockActive = !!game?.clock && !client.playing.value;
  useTicker(clockActive, 10);
  if (!room || !game) {
    return (
      <div class="table-screen">
        <div ref={hostRef} class="table-host" />
        <div ref={hudRef} class="hud" />
      </div>
    );
  }

  const mine = client.mySeats.value;
  const myTurn = client.myTurn.value;
  const desc = modeDescriptor(game.mode);
  const players = game.seatOrder;
  const twoSides = players.length === 2;
  const clockFrac = game.clock ? Math.max(0, (game.clock.remainingMs - (performance.now() - client.stateAt.value)) / game.clock.totalMs) : null;
  const shooter = game.currentShooter;
  const leftHanded = settings.value.leftHanded;
  const showPower = myTurn && game.phase !== 'ball_in_hand' && !client.playing.value;
  const soloNext =
    room.settings.mode === 'trickshot' && room.result?.solo && !room.result.solo.failed
      ? () => {
          const i = CHALLENGES.findIndex((c) => c.id === room.result?.solo?.challengeId);
          const next = CHALLENGES[i + 1];
          if (next && client.isHost.value) {
            client.send({ t: 'settings', patch: { challengeId: next.id } });
            client.send({ t: 'start' });
          }
        }
      : null;

  function unlock(): void {
    sfx.unlockAudio();
  }

  const cards = players.map((seat, k) => (
    <PlayerCard
      key={seat}
      seat={seat}
      view={room.seats[seatIndex(seat)] ?? null}
      game={game}
      room={room}
      turn={seat === shooter && game.phase !== 'game_over'}
      clock={seat === shooter ? clockFrac : null}
      mine={mine.includes(seatIndex(seat))}
      compact={!twoSides}
      side={twoSides ? (k === 0 ? 'left' : 'right') : 'left'}
      layout={layout}
    />
  ));
  const duelScore = twoSides
    ? {
        wins: players.map((seat) => room.match?.wins[seatIndex(seat)] ?? 0) as [number, number],
        colors: players.map((seat) => SEAT_COLORS[seatIndex(seat) % SEAT_COLORS.length]) as [string, string],
      }
    : null;

  // The controls, placed per layout: the power cue on the strong-hand side, the ball return
  // opposite, the dock under the table (or stood on end beside it on a short screen).
  const cue = cueStyle(room.seats[seatIndex(shooter)]?.loadout.cue);
  const power = (horizontal: boolean) => <PowerBar controls={controls} enabled={showPower} horizontal={horizontal} reverse={horizontal && leftHanded} cue={cue} />;
  const ballReturn = (horizontal: boolean) => <BallReturn potted={potted} set={room.balls} horizontal={horizontal} />;
  const dock =
    !room.displayMode || mine.length > 0 ? (
      <Dock client={client} controls={controls} game={game} room={room} layout={layout} onEmote={() => setEmoteOpen((o) => !o)} onSpin={() => setSpinOpen((o) => !o)} spinOpen={spinOpen} />
    ) : null;
  const sideA = layout === 'short' && leftHanded ? <>{dock}{ballReturn(false)}</> : leftHanded ? ballReturn(false) : power(false);
  const sideB = layout === 'short' && !leftHanded ? <>{ballReturn(false)}{dock}</> : leftHanded ? power(false) : ballReturn(false);

  return (
    <div class={`table-screen is-${layout} ${portrait ? 'is-portrait' : ''} ${leftHanded ? 'is-lefty' : ''} ${myTurn ? 'is-my-turn' : ''}`} onPointerDown={unlock}>
      <div ref={hostRef} class="table-host" />
      <div ref={hudRef} class="hud">
        <div class="hud-top">
          {desc.solo ? (
            <div class="hud-players is-solo">
              {cards[0]}
              <SoloStatus game={game} stateAt={client.stateAt.value} />
            </div>
          ) : twoSides ? (
            <div class="hud-players is-duel">
              {cards[0]}
              <MatchStatus room={room} game={game} score={duelScore} />
              {cards[1]}
            </div>
          ) : (
            <div class="hud-players is-group">
              <MatchStatus room={room} game={game} />
              <div class="hud-chips">{cards}</div>
            </div>
          )}
          <div class="hud-actions">
            {room.displayMode && room.code && <span class="hud-code">Join: <b>{room.code}</b></span>}
            <IconButton icon="menu" label="Menu" onClick={() => setMenuOpen(true)} />
          </div>
        </div>

        <div class="hud-left">{!portrait && sideA}</div>
        <div class="hud-right">{!portrait && sideB}</div>

        <div class="hud-bottom">
          {portrait ? (
            <>
              {ballReturn(true)}
              {dock}
              {power(true)}
            </>
          ) : (
            layout === 'wide' && dock
          )}
        </div>

        <Notices items={notices} />
        <Bubbles items={bubbles} room={room} />
        {spinOpen && myTurn && <SpinPicker controls={controls} set={room.balls} onClose={() => setSpinOpen(false)} />}
        {emoteOpen && <EmotePanel onPick={(id) => client.send({ t: 'emote', id })} onClose={() => setEmoteOpen(false)} />}
        {client.status.value === 'host-away' && <div class="net-banner">The host lost connection — waiting for them to come back…</div>}
        {client.status.value === 'reconnecting' && <div class="net-banner">Reconnecting…</div>}
      </div>

      {room.phase === 'intermission' && <Intermission room={room} />}
      {room.phase === 'results' && (
        <Results
          room={room}
          mine={mine}
          isHost={client.isHost.value}
          rewards={rewards}
          onRematch={() => {
            setRewards(null);
            client.send({ t: 'rematch' });
          }}
          onLobby={() => client.send({ t: 'toLobby' })}
          onLeave={onLeave}
          onNext={soloNext}
        />
      )}
      {menuOpen && <TableMenu session={session} room={room} onClose={() => setMenuOpen(false)} onLeave={onLeave} />}
    </div>
  );
}

export function isTableRoom(room: RoomView | null): boolean {
  return !!room && room.phase !== 'lobby';
}

export { challengeById, profile };
