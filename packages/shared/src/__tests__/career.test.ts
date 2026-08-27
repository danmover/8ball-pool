import { describe, expect, it } from 'vitest';
import {
  CAREER,
  careerNext,
  careerOpponentById,
  careerOpponents,
  careerProgress,
  careerUnlocked,
} from '../career.js';
import { CATALOG } from '../cosmetics.js';
import { TABLE_THEME_IDS } from '../career.js';
import { modeDescriptor } from '../modes/index.js';
import { RULE_SETS } from '../ruleSets.js';

/**
 * The ladder exists to give the four bot tiers and the seven drawn rooms something to be *for*.
 * Most of what can go wrong with it is a typo — an opponent pointing at a venue or a cosmetic
 * that doesn't exist — so that's what these check, along with the unlock order.
 */

describe('career data', () => {
  const all = careerOpponents();

  it('has unique opponent ids', () => {
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
  });

  it('only awards cosmetics that actually exist', () => {
    const ids = new Set(CATALOG.map((c) => c.id));
    for (const o of all) {
      expect(ids.has(o.reward), `${o.name} awards unknown item ${o.reward}`).toBe(true);
    }
  });

  it('never awards the same cosmetic twice', () => {
    const rewards = all.map((o) => o.reward);
    expect(new Set(rewards).size).toBe(rewards.length);
  });

  it('only plays modes that exist and seat two players', () => {
    for (const o of all) {
      const mode = modeDescriptor(o.mode);
      expect(mode, `${o.name} plays unknown mode ${o.mode}`).toBeDefined();
      expect(mode.minPlayers, `${o.name} plays ${o.mode}, which needs more than two`).toBeLessThanOrEqual(2);
    }
  });

  it('only names rule sets that exist', () => {
    for (const o of all) expect(RULE_SETS[o.ruleSet]).toBeDefined();
  });

  it('only sends you to venues that exist', () => {
    for (const o of all) {
      expect(
        (TABLE_THEME_IDS as readonly string[]).includes(o.venue),
        `${o.name} plays at unknown venue ${o.venue}`
      ).toBe(true);
    }
  });

  it('gets harder, never easier', () => {
    // Progression across three axes at once is the whole design — opponent, rules and match
    // length — so at minimum the difficulty must never go backwards.
    const rank = { rookie: 0, club: 1, shark: 2, legend: 3 } as const;
    const rules = { casual: 0, pub: 1, tournament: 2 } as const;
    for (let i = 1; i < all.length; i++) {
      expect(rank[all[i].difficulty]).toBeGreaterThanOrEqual(rank[all[i - 1].difficulty]);
      expect(rules[all[i].ruleSet]).toBeGreaterThanOrEqual(rules[all[i - 1].ruleSet]);
    }
  });

  it('pays more the further up you get', () => {
    for (let i = 1; i < all.length; i++) {
      expect(all[i].xp).toBeGreaterThan(all[i - 1].xp);
    }
  });

  it('ends with a single champion', () => {
    expect(CAREER[CAREER.length - 1].opponents).toHaveLength(1);
  });
});

describe('career progression', () => {
  const all = careerOpponents();

  it('opens with exactly one opponent available', () => {
    expect(careerUnlocked([])).toEqual([all[0].id]);
    expect(careerNext([])?.id).toBe(all[0].id);
  });

  it('opens the next one as each is beaten', () => {
    const beaten = [all[0].id];
    expect(careerUnlocked(beaten)).toEqual([all[0].id, all[1].id]);
    expect(careerNext(beaten)?.id).toBe(all[1].id);
  });

  it('keeps beaten opponents available to replay', () => {
    const beaten = all.slice(0, 3).map((o) => o.id);
    const unlocked = careerUnlocked(beaten);
    for (const id of beaten) expect(unlocked).toContain(id);
  });

  it('does not skip ahead when a later opponent is somehow marked beaten', () => {
    // Guards against a corrupt or hand-edited save unlocking the whole ladder.
    const unlocked = careerUnlocked([all[all.length - 1].id]);
    expect(unlocked).toEqual([all[0].id]);
  });

  it('reports the ladder finished once everyone is beaten', () => {
    const beaten = all.map((o) => o.id);
    expect(careerNext(beaten)).toBeNull();
    expect(careerProgress(beaten)).toEqual({ beaten: all.length, total: all.length });
  });

  it('looks opponents up by id', () => {
    expect(careerOpponentById(all[0].id)?.name).toBe(all[0].name);
    expect(careerOpponentById('nobody')).toBeUndefined();
  });
});
