import {
  cupField,
  modeDescriptor,
  type BotTier,
  type CupDef,
  type GameMode,
  type RuleSetId,
} from '@8ball/shared';
import { hostTable, savedHost, joinTable, type HostRunner } from '../net/session';
import { navigate } from '../app/router';
import { rememberPlay } from '../state/profile';
import { toast } from '../ui/kit';

/**
 * Starting games. Every way in — a quick match, a cup, a puzzle, a room for friends — ends in the
 * same place: a table hosted on this device (or joined on someone else's).
 */

export function playBots(opts: { mode: GameMode; botIds: string[]; raceTo: number; ruleSet: RuleSetId; tier: BotTier }): void {
  rememberPlay({ mode: opts.mode, botId: opts.botIds[0] ?? null, tier: opts.tier, raceTo: opts.raceTo, ruleSet: opts.ruleSet });
  const runner = hostTable({
    online: false,
    settings: { mode: opts.mode, raceTo: opts.raceTo, ruleSet: opts.ruleSet, seats: 1 + opts.botIds.length, format: 'match', botTier: opts.tier },
  });
  opts.botIds.forEach((id, i) => runner.client.send({ t: 'addBot', seat: i + 1, botId: id }));
  runner.client.send({ t: 'start' });
  navigate('/local');
}

export function playSolo(mode: GameMode, challengeId: string | null = null): void {
  const runner = hostTable({ online: false, settings: { mode, challengeId } });
  runner.client.send({ t: 'start' });
  navigate('/local');
}

export function playCup(cup: CupDef): void {
  const field = cupField(cup);
  const runner = hostTable({
    online: false,
    cupId: cup.id,
    settings: { mode: cup.mode, format: 'tournament', entrants: 8, raceTo: cup.raceTo, ruleSet: 'standard' },
  });
  field.forEach((bot, i) => runner.client.send({ t: 'addBot', seat: i + 1, botId: bot.id }));
  runner.client.send({ t: 'start' });
  navigate('/local');
}

/** A local lobby: bots and people sharing this device, set up however you like. */
export function passAndPlay(): void {
  hostTable({ online: false, settings: { mode: 'eightball', seats: 2 } });
  navigate('/local');
}

/** Hosts a room on the relay. Resolves once it has a code (or fails). */
export function hostOnline(displayMode: boolean): Promise<HostRunner | null> {
  return new Promise((resolve) => {
    let done = false;
    const runner = hostTable({
      online: true,
      displayMode,
      settings: { mode: 'eightball', seats: 2 },
      onReady: (code) => {
        if (done) return;
        done = true;
        navigate(`/room/${code}`);
        resolve(runner);
      },
      onError: (message) => {
        if (done) return;
        done = true;
        toast(message, 'bad', 'wifiOff');
        runner.destroy();
        resolve(null);
      },
    });
  });
}

export function joinRoom(code: string): boolean {
  const client = joinTable(code);
  if (!client) {
    toast('Room codes are 4 letters and numbers', 'bad');
    return false;
  }
  navigate(`/room/${code.toUpperCase()}`);
  return true;
}

/** Picks the game back up after a reload, if this device was hosting one. */
export function resumeHosted(): boolean {
  const saved = savedHost();
  if (!saved) return false;
  hostTable({ online: saved.online, resume: saved, cupId: saved.cupId, onError: (m) => toast(m, 'bad') });
  navigate(saved.online && saved.code ? `/room/${saved.code}` : '/local');
  return true;
}

export function modeLabel(mode: GameMode): string {
  return modeDescriptor(mode).name;
}
