/**
 * How strictly the game is refereed.
 *
 * Two presets rather than a page of switches. Standard is how most people actually play: pot
 * anything of yours, nominate the pocket for the black, ball in hand anywhere after a foul. Pro
 * is the league game: call every shot, break properly, the kitchen after a break scratch, and
 * three fouls in a row loses the frame.
 */

export type RuleSetId = 'standard' | 'pro';

export interface RuleOptions {
  /** Nominate ball and pocket on every shot; anything else dropping ends the visit. */
  callShot: boolean;
  /** Nominate the pocket for the 8-ball. Wrong pocket loses. */
  callEight: boolean;
  /** The break must drive four balls to a rail, or pot something. */
  breakRequirement: boolean;
  /** Scratch on the break and the incoming player places behind the head string. */
  kitchenAfterBreakScratch: boolean;
  /** Three fouls in a row loses the frame. */
  threeFoul: boolean;
}

export const RULE_SETS: Record<RuleSetId, { name: string; blurb: string; options: RuleOptions }> = {
  standard: {
    name: 'Standard',
    blurb: 'Pot anything of yours. Call the pocket for the 8. Ball in hand after a foul.',
    options: {
      callShot: false,
      callEight: true,
      breakRequirement: false,
      kitchenAfterBreakScratch: false,
      threeFoul: false,
    },
  },
  pro: {
    name: 'Pro',
    blurb: 'Call every shot, break properly, three fouls in a row loses the frame.',
    options: {
      callShot: true,
      callEight: true,
      breakRequirement: true,
      kitchenAfterBreakScratch: true,
      threeFoul: true,
    },
  },
};

export const DEFAULT_RULE_SET: RuleSetId = 'standard';

export function ruleOptions(id: RuleSetId | undefined): RuleOptions {
  return (RULE_SETS[id ?? DEFAULT_RULE_SET] ?? RULE_SETS[DEFAULT_RULE_SET]).options;
}

export function ruleSetOrder(): RuleSetId[] {
  return ['standard', 'pro'];
}

/** How many balls the break must send to a rail when `breakRequirement` is on. */
export const BREAK_BALLS_TO_RAIL = 4;

/** Consecutive fouls that lose the frame when `threeFoul` is on. */
export const FOUL_LIMIT = 3;
