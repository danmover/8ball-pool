import { describe, expect, it } from 'vitest';
import {
  escapeNotice,
  evictionIndex,
  heraldWeight,
  heraldWins,
  noticeKey,
  noticeSpec,
  type NoticeKind,
} from '../notices';

/*
 * The notice rail replaced four separate systems that each announced things their own way and
 * two of which drew at overlapping coordinates. Putting them in one column is a layout fix;
 * these are the rules that decide what that column *says* when several things happen at once,
 * which is the half of the change that can actually be wrong.
 *
 * The rendering isn't tested here — there is no DOM in this suite, and adding one to assert
 * that an element got a class would be a lot of machinery for very little. What matters is
 * the ranking, and the ranking is plain functions.
 */

describe('lanes', () => {
  it('splits moments from the log', () => {
    // A herald is a moment: one at a time, big, gone. A feed note is a line in a log.
    expect(noticeSpec('turn').lane).toBe('herald');
    expect(noticeSpec('feat').lane).toBe('herald');
    expect(noticeSpec('hype').lane).toBe('herald');
    expect(noticeSpec('info').lane).toBe('feed');
    expect(noticeSpec('reward').lane).toBe('feed');
    expect(noticeSpec('foul').lane).toBe('feed');
  });

  it('interrupts a screen reader only for a foul', () => {
    const urgent = (['info', 'foul', 'reward', 'turn', 'feat', 'hype'] as NoticeKind[]).filter(
      (k) => noticeSpec(k).urgent
    );
    // `assertive` exists for the thing that cannot wait. Spend it on more than one kind and a
    // busy shot has the page talking over itself.
    expect(urgent).toEqual(['foul']);
  });

  it('holds a reward longer than a passing note', () => {
    expect(noticeSpec('reward').ms).toBeGreaterThan(noticeSpec('info').ms);
  });
});

describe('heraldWeight', () => {
  it('ranks a combo above a turn change', () => {
    // The case this is for: you pot two, the turn passes, and both want the same space.
    expect(heraldWeight('hype')).toBeGreaterThan(heraldWeight('turn'));
  });

  it('climbs with the combo tier', () => {
    const double = heraldWeight('hype', 1.24);
    const quad = heraldWeight('hype', 1.72);
    const game = heraldWeight('hype', 2.2);
    expect(quad).toBeGreaterThan(double);
    expect(game).toBeGreaterThan(quad);
  });

  it('puts GAME! out of reach of the turn that follows it', () => {
    // The frame-winning ball drops, then the state broadcast says the shooter changed. If the
    // turn banner could take the lane, the last thing you would see is whose shot it is.
    expect(heraldWins(heraldWeight('turn'), heraldWeight('hype', 2.2))).toBe(false);
  });
});

describe('heraldWins', () => {
  it('yields an empty lane to anything', () => {
    expect(heraldWins(heraldWeight('turn'), null)).toBe(true);
  });

  it('gives a tie to the newcomer', () => {
    // Two turn changes in a row: the second is the current one, and it has to replace the
    // first rather than be dropped for arriving second.
    expect(heraldWins(heraldWeight('turn'), heraldWeight('turn'))).toBe(true);
  });

  it('drops something quieter than what is already up', () => {
    expect(heraldWins(heraldWeight('turn'), heraldWeight('feat'))).toBe(false);
  });
});

describe('noticeKey', () => {
  it('folds identical messages together', () => {
    expect(noticeKey('foul', 'Not a legal shot')).toBe(noticeKey('foul', 'Not a legal shot'));
  });

  it('keeps the same words apart when they mean different things', () => {
    expect(noticeKey('foul', 'Ravi left')).not.toBe(noticeKey('info', 'Ravi left'));
  });

  it('lets a caller tie two different messages to one slot', () => {
    // "Ravi lost connection" and "Ravi is back" are the same running story, so the second
    // replaces the first instead of stacking under it.
    expect(noticeKey('foul', 'Ravi lost connection', 'dc:Ravi')).toBe(
      noticeKey('info', 'Ravi is back', 'dc:Ravi')
    );
  });
});

describe('evictionIndex', () => {
  it('sacrifices the least important note, not the oldest', () => {
    // A foul, then two bits of chatter, then a reward arrives. The foul is the reason you
    // have ball in hand; a plain FIFO would throw it away first.
    const foul = noticeSpec('foul').weight;
    const info = noticeSpec('info').weight;
    expect(evictionIndex([foul, info, info])).toBe(1);
  });

  it('breaks a tie by age', () => {
    const info = noticeSpec('info').weight;
    expect(evictionIndex([info, info, info])).toBe(0);
  });

  it('will drop a foul when everything up is a foul', () => {
    const foul = noticeSpec('foul').weight;
    expect(evictionIndex([foul, foul, foul])).toBe(0);
  });
});

describe('escapeNotice', () => {
  it('neuters markup in a name somebody else chose', () => {
    // Names arrive from other players and land in `innerHTML`.
    expect(escapeNotice('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('closes the attribute escape as well as the tag one', () => {
    expect(escapeNotice(`" '`)).toBe('&quot; &#39;');
  });

  it('escapes the ampersand first, so an escape cannot be smuggled in', () => {
    expect(escapeNotice('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('leaves ordinary commentary alone', () => {
    expect(escapeNotice('Ravi lost connection — 28s to come back')).toBe(
      'Ravi lost connection — 28s to come back'
    );
  });
});
