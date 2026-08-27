/**
 * How strictly the game is refereed.
 *
 * The rules the modes implemented were a simplification: no call shot, no requirement on the
 * break, no kitchen, no three-foul. Adding all of that unconditionally would have made a party
 * game pedantic, so each is a switch — and the switches are grouped into three presets, because
 * nobody wants to tick eight boxes before playing a frame with their mates.
 */

export type RuleSetId = 'casual' | 'pub' | 'tournament';

export interface RuleOptions {
  /**
   * Nominate the ball and pocket. Anything else that drops doesn't count and your visit ends —
   * the single biggest difference between pub pool and the real game, because it stops flukes
   * paying out.
   *
   * Declining to nominate is a *safety*: you keep the shot legal, accept that the visit ends,
   * and play for position. That falls out of the same check rather than needing its own flag.
   */
  callShot: boolean;
  /** The break must drive four balls to a rail, or pot something, or it's a foul. */
  breakRequirement: boolean;
  /** Scratch on the break and the incoming player is restricted to behind the head string. */
  kitchenAfterBreakScratch: boolean;
  /** Three fouls in a row loses the frame. */
  threeFoul: boolean;
}

/**
 * Not here yet, deliberately: the frozen-ball clause.
 *
 * The real rule is that a ball already touching a cushion doesn't count as having reached a
 * rail unless it leaves and comes back — which needs the *identity* of the cushion each ball
 * is frozen to recorded before the shot and matched against the rail contacts afterwards.
 * That's a real piece of work for a subtle rule, and a flag that silently did nothing would be
 * worse than not having it.
 */

export const RULE_SETS: Record<RuleSetId, { name: string; blurb: string; options: RuleOptions }> = {
  casual: {
    name: 'Casual',
    blurb: 'Pot anything, break however you like. Best for a first game.',
    options: {
      callShot: false,
      breakRequirement: false,
      kitchenAfterBreakScratch: false,
      threeFoul: false,
    },
  },
  pub: {
    name: 'Pub',
    blurb: 'A proper break, and the kitchen after a break scratch. Flukes still count.',
    options: {
      callShot: false,
      breakRequirement: true,
      kitchenAfterBreakScratch: true,
      threeFoul: false,
    },
  },
  tournament: {
    name: 'Tournament',
    blurb: 'Call your shots. Three fouls loses the frame. Nothing is a fluke.',
    options: {
      callShot: true,
      breakRequirement: true,
      kitchenAfterBreakScratch: true,
      threeFoul: true,
    },
  },
};

export const DEFAULT_RULE_SET: RuleSetId = 'casual';

export function ruleOptions(id: RuleSetId | undefined): RuleOptions {
  return RULE_SETS[id ?? DEFAULT_RULE_SET].options;
}

export function ruleSetOrder(): RuleSetId[] {
  return ['casual', 'pub', 'tournament'];
}

/** How many balls the break must send to a rail when `breakRequirement` is on. */
export const BREAK_BALLS_TO_RAIL = 4;

/** Consecutive fouls that lose the frame when `threeFoul` is on. */
export const FOUL_LIMIT = 3;
