import {
  CURVE_ELEVATION,
  POWER_INFO,
  bestCallout,
  seatIndex,
  type GameState,
  type RoomView,
  type ShotPlayback,
} from '@8ball/shared';

/**
 * What the table says after a shot.
 *
 * Built from the shot's summary, which the host computed from the same simulation everybody just
 * watched, so every device announces the same thing. Only what is true gets said — see
 * `callouts.ts` for why praise that fires on everything stops being praise.
 */

export type NoticeTone = 'info' | 'good' | 'great' | 'bad' | 'turn';

export interface Notice {
  text: string;
  sub?: string;
  tone: NoticeTone;
}

export interface ShotTally {
  multiPots: number;
  kickPots: number;
  jumpPots: number;
  orbs: number;
}

export function emptyTally(): ShotTally {
  return { multiPots: 0, kickPots: 0, jumpPots: 0, orbs: 0 };
}

function nameOf(room: RoomView | null, seat: number, mine: number[]): string {
  if (mine.includes(seat) && mine.length === 1) return 'You';
  return room?.seats[seat]?.name ?? `Player ${seat + 1}`;
}

export function shotFeedback(
  shot: ShotPlayback,
  before: GameState | null,
  room: RoomView | null,
  mine: number[]
): { notices: Notice[]; tally: ShotTally | null } {
  const state = shot.result;
  const s = state.lastShot;
  const notices: Notice[] = [];
  if (!s) return { notices, tally: null };
  const shooter = seatIndex(s.seat);
  const who = nameOf(room, shooter, mine);
  const isMe = mine.includes(shooter);

  if (shot.strike.miscued) notices.push({ text: 'Miscue!', sub: 'The tip slipped off the ball', tone: 'bad' });

  if (s.foul) {
    notices.push({ text: 'Foul', sub: s.foul, tone: 'bad' });
  } else {
    const remaining = state.balls.filter((b) => b.id !== 0 && !b.pocketed).length;
    const masse = shot.input.elevation >= CURVE_ELEVATION - 0.01 && shot.input.elevation < 0.9 && Math.abs(shot.input.spin.x) > 0.3;
    const call = bestCallout({
      pots: s.potted.length,
      potDistance: 0,
      railsBeforeContact: s.railsFirst,
      railsAfterContact: 0,
      wonFrame: s.wonFrame,
      ballsRemaining: remaining,
      visitRun: s.run,
      jumped: s.jumped,
      massed: masse && !s.jumped,
      fouled: false,
    });
    if (call && !s.wonFrame) notices.push({ text: call.text, tone: call.tone === 'great' ? 'great' : 'good' });
  }

  // Groups decided.
  if (before && state.mode === 'eightball') {
    const had = before.players[s.seat]?.group;
    const now = state.players[s.seat]?.group;
    if (!had && now) notices.push({ text: `${who === 'You' ? "You're" : `${who} is`} on ${now === 'solid' ? 'solids' : 'stripes'}`, tone: 'info' });
  }

  if (state.mode === 'killer' && s.lifeDelta !== 0) {
    const me = state.players[s.seat];
    if (me?.eliminated) notices.push({ text: `${who} ${who === 'You' ? 'are' : 'is'} out!`, tone: 'bad' });
    else if (s.lifeDelta > 0) notices.push({ text: 'Extra life!', sub: `${who} potted the black`, tone: 'great' });
    else if (!s.foul) notices.push({ text: 'Life lost', sub: `${who} — ${me?.lives ?? 0} left`, tone: 'bad' });
  }

  if (state.mode === 'power') {
    if (s.power) notices.push({ text: `${POWER_INFO[s.power].glyph} ${POWER_INFO[s.power].name}`, tone: 'great' });
    for (const p of s.collected) notices.push({ text: `${POWER_INFO[p].glyph} ${POWER_INFO[p].name}`, sub: `${who} picked it up`, tone: 'good' });
    if (s.points > 1) notices.push({ text: `+${s.points} points`, tone: 'good' });
  }

  // Whose turn it is now.
  if (state.phase !== 'game_over') {
    const next = seatIndex(state.currentShooter);
    if (next !== shooter || s.foul) {
      const mineNext = mine.includes(next);
      const name = room?.seats[next]?.name ?? `Player ${next + 1}`;
      const bih = state.phase === 'ball_in_hand';
      if (mineNext) notices.push({ text: mine.length > 1 ? `${name}'s turn` : 'Your turn', sub: bih ? 'Ball in hand' : undefined, tone: 'turn' });
      else notices.push({ text: `${name}'s turn`, sub: bih ? 'Ball in hand' : undefined, tone: 'info' });
    }
  }

  const tally: ShotTally | null = isMe
    ? {
        multiPots: !s.foul && s.potted.length >= 2 ? 1 : 0,
        kickPots: !s.foul && s.railsFirst > 0 && s.potted.length > 0 ? 1 : 0,
        jumpPots: !s.foul && s.jumped && s.potted.length > 0 ? 1 : 0,
        orbs: s.collected.length,
      }
    : null;
  return { notices, tally };
}
