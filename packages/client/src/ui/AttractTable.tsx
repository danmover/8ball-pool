import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { CUE_BALL_ID, ballSetStyle, cueStyle, fxStyle, rackBalls, seatIndex, tableStyle } from '@8ball/shared';
import { TableView } from '../render/TableView';
import { ShotPlayer } from '../game/shotPlayer';
import { HostRunner } from '../net/session';
import { settings } from '../state/settings';
import { profile } from '../state/profile';

/**
 * The home screen's backdrop: two bots playing a real frame on your own table, behind the menu.
 *
 * It is the whole engine running — the same session, bots, replay and renderer as a real game —
 * so the first thing anybody sees is what the game actually looks like. Turned off on low quality
 * and with reduced motion, where a still rack stands in.
 */
export function AttractTable({ tilt = true }: { tilt?: boolean }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = settings.value;
    const p = profile.value;
    const view = new TableView(host.current!, {
      quality: s.quality === 'high' ? 'medium' : s.quality,
      table: tableStyle(p.loadout.table),
      balls: ballSetStyle(p.loadout.balls),
      cue: cueStyle(p.loadout.cue),
      fx: fxStyle(p.loadout.fx),
      effects: s.effects && !s.reduceMotion,
      tilt,
    });
    view.setBalls(rackBalls());
    const still = s.reduceMotion || s.quality === 'low';
    if (still) return () => view.dispose();

    const runner = new HostRunner({ online: false, displayMode: true, persist: false, settings: { mode: 'eightball', seats: 2, raceTo: 1 } });
    const client = runner.client;
    const pair = [
      ['bot.shark', 'bot.kim'],
      ['bot.ray', 'bot.pete'],
      ['bot.nova', 'bot.viper'],
      ['bot.bex', 'bot.sam'],
    ][Math.floor(Math.random() * 4)];
    client.send({ t: 'addBot', seat: 0, botId: pair[0] });
    client.send({ t: 'addBot', seat: 1, botId: pair[1] });
    client.send({ t: 'start' });

    const offs = [
      client.events.on('shot', (shot) => {
        client.claimShot(shot.id);
        const seat = client.room.value?.seats[seatIndex(shot.seat)];
        view.setCueStyle(cueStyle(seat?.loadout.cue));
        view.setFx(fxStyle(seat?.loadout.fx));
        view.setGuide(null);
        const cue = shot.pre.find((b) => b.id === CUE_BALL_ID);
        if (cue) {
          view.setAim({ from: cue.pos, angle: shot.input.angle, power: shot.input.power, elevation: shot.input.elevation });
          view.strike();
        }
        view.play(new ShotPlayer(shot), () => {}, () => client.finishShot(shot.id));
      }),
      client.events.on('aim', ({ aim }) => {
        const g = client.game.value;
        const cue = g?.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
        if (cue && !client.playing.value) view.setAim({ from: cue.pos, angle: aim.angle, power: aim.power, elevation: aim.elevation }, true);
      }),
      client.events.on('state', (g) => view.setBalls(g.balls)),
    ];
    // Start a fresh frame whenever one finishes.
    const unsub = client.room.subscribe((r) => {
      if (r?.phase === 'results') setTimeout(() => client.send({ t: 'rematch' }), 2500);
    });
    // Save the battery when the tab is hidden.
    return () => {
      offs.forEach((o) => o());
      unsub();
      runner.destroy();
      view.dispose();
    };
  }, []);
  return <div ref={host} class="attract" aria-hidden="true" />;
}
