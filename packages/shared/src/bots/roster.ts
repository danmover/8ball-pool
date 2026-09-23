import type { BotTier } from '../types.js';
import type { Avatar, Loadout } from '../cosmetics.js';

/**
 * The computer players.
 *
 * A tier decides how well a bot plays; a personality decides *how* it plays and what it says.
 * Two Pro bots can feel completely different: one grinds safeties and waits for mistakes, the
 * other goes for everything and occasionally makes a spectacle of it.
 */

export interface BotSkill {
  /** Aim error as contact-point error in ball radii — the honest model of how people miss. */
  contactError: number;
  /** Fraction of the intended power the bot may be off by. */
  powerError: number;
  /** Milliseconds of simulation it may spend choosing a shot. */
  searchMs: number;
  /** Direct lines fed into the search. */
  width: number;
  /** 0..1 — how much it cares where the cue ball stops. */
  position: number;
  /** 0..1 — how readily it plays safe when nothing good is on. */
  safety: number;
  /** Uses draw/follow/side for position. */
  spin: boolean;
  /** Looks for bank shots and combinations. */
  creative: boolean;
  /** Samples used to estimate how likely a shot is to go in. */
  samples: number;
  thinkMs: [number, number];
}

export const TIER_SKILL: Record<BotTier, BotSkill> = {
  rookie: {
    contactError: 0.58,
    powerError: 0.22,
    searchMs: 140,
    width: 5,
    position: 0,
    safety: 0,
    spin: false,
    creative: false,
    samples: 1,
    thinkMs: [1300, 2300],
  },
  amateur: {
    contactError: 0.3,
    powerError: 0.13,
    searchMs: 300,
    width: 8,
    position: 0.35,
    safety: 0.3,
    spin: false,
    creative: false,
    samples: 2,
    thinkMs: [1100, 1900],
  },
  pro: {
    contactError: 0.1,
    powerError: 0.07,
    searchMs: 650,
    width: 12,
    position: 0.8,
    safety: 0.75,
    spin: true,
    creative: true,
    samples: 3,
    thinkMs: [950, 1600],
  },
  master: {
    contactError: 0.022,
    powerError: 0.03,
    searchMs: 1100,
    width: 18,
    position: 1,
    safety: 1,
    spin: true,
    creative: true,
    samples: 5,
    thinkMs: [850, 1400],
  },
};

export const TIER_LABELS: Record<BotTier, string> = {
  rookie: 'Rookie',
  amateur: 'Amateur',
  pro: 'Pro',
  master: 'Master',
};

export const TIER_ORDER: BotTier[] = ['rookie', 'amateur', 'pro', 'master'];

export interface BotStyle {
  /** 0..1 — will take on hard pots rather than play safe. */
  aggression: number;
  /** 0..1 — likes a bank, a jump or a power shot when it is close enough to the best option. */
  flair: number;
  /** 0..1 — how often it talks. */
  chatter: number;
}

export type BotLine = 'greet' | 'goodShot' | 'miss' | 'foul' | 'win' | 'lose' | 'opponentMiss';

export interface BotProfile {
  id: string;
  name: string;
  tier: BotTier;
  avatar: Avatar;
  loadout: Loadout;
  bio: string;
  style: BotStyle;
  lines: Record<BotLine, string[]>;
}

const L = (cue: string, balls: string, table: string, fx: string): Loadout => ({ cue, balls, table, fx });

export const BOTS: BotProfile[] = [
  // ------------------------------------------------------------------ rookies
  {
    id: 'bot.charlie',
    name: 'Chalky Charlie',
    tier: 'rookie',
    avatar: { icon: '🐸', color: '#39d98a' },
    loadout: L('cue.oak', 'balls.classic', 'table.club', 'fx.clean'),
    bio: 'Three weeks into lessons and loving every minute of it.',
    style: { aggression: 0.8, flair: 0.1, chatter: 0.5 },
    lines: {
      greet: ['Hi! Go easy on me?', 'I have been practising!', 'Ooh, a real game!'],
      goodShot: ['Did you see that?!', 'I meant that. Mostly.', 'Yesss!'],
      miss: ['Whoops.', 'The table is wonky.', 'So close!'],
      foul: ['Oh no, not again…', 'Sorry sorry sorry.'],
      win: ['I WON? I won!', 'Wait till I tell my coach!'],
      lose: ['Good game! Rematch?', 'You are really good.'],
      opponentMiss: ['Phew!', 'My turn!'],
    },
  },
  {
    id: 'bot.lou',
    name: 'Lucky Lou',
    tier: 'rookie',
    avatar: { icon: '🍀', color: '#ffc542' },
    loadout: L('cue.oak', 'balls.sorbet', 'table.club', 'fx.streak'),
    bio: 'Never aims. Somehow it keeps going in.',
    style: { aggression: 1, flair: 0.4, chatter: 0.6 },
    lines: {
      greet: ['Feeling lucky today.', 'Let us roll the dice.'],
      goodShot: ['Skill. Obviously.', 'Told you. Lucky.', 'Called it. Sort of.'],
      miss: ['Luck ran out.', 'Eh, next one.'],
      foul: ['That counts as a warm-up.'],
      win: ['Luck is a skill!', 'Clover never fails.'],
      lose: ['Should have rubbed the clover.', 'Fair play.'],
      opponentMiss: ['Luck is contagious.'],
    },
  },
  {
    id: 'bot.wendy',
    name: 'Wobbly Wendy',
    tier: 'rookie',
    avatar: { icon: '🐙', color: '#ff5fa2' },
    loadout: L('cue.oak', 'balls.classic', 'table.crimson', 'fx.clean'),
    bio: 'All the enthusiasm, none of the bridge hand.',
    style: { aggression: 0.6, flair: 0.2, chatter: 0.4 },
    lines: {
      greet: ['Hello hello!', 'Which end do I hold again?'],
      goodShot: ['Wheee!', 'Look at it go!'],
      miss: ['Wobble wobble.', 'My arm slipped.'],
      foul: ['Oopsie daisy.'],
      win: ['Wobble to victory!'],
      lose: ['Good game, friend!'],
      opponentMiss: ['Wobbly too, eh?'],
    },
  },

  // ------------------------------------------------------------------ amateurs
  {
    id: 'bot.pete',
    name: 'Pub Pete',
    tier: 'amateur',
    avatar: { icon: '🦊', color: '#ff9444' },
    loadout: L('cue.ebony', 'balls.classic', 'table.club', 'fx.streak'),
    bio: 'Undefeated at the Red Lion on Tuesdays. Mostly.',
    style: { aggression: 0.7, flair: 0.3, chatter: 0.6 },
    lines: {
      greet: ['Your break, mate.', 'Winner buys the next round.'],
      goodShot: ['Get in!', 'Textbook.', 'That is the Tuesday special.'],
      miss: ['Unlucky, Pete.', 'Kicked off a bit of chalk.'],
      foul: ['Blimey.'],
      win: ['Mine is a pint.', 'Good game, well played.'],
      lose: ['You have been practising.', 'Rematch. Double or nothing.'],
      opponentMiss: ['Hard lines.'],
    },
  },
  {
    id: 'bot.sam',
    name: 'Steady Sam',
    tier: 'amateur',
    avatar: { icon: '🐼', color: '#8a94a6' },
    loadout: L('cue.carbon', 'balls.tv', 'table.tour', 'fx.clean'),
    bio: 'Plays the percentages. Rarely spectacular, rarely wrong.',
    style: { aggression: 0.35, flair: 0, chatter: 0.3 },
    lines: {
      greet: ['Good luck.', 'Let us have a tidy one.'],
      goodShot: ['Steady.', 'Nice and simple.'],
      miss: ['Hm.', 'Should have played safe.'],
      foul: ['Careless.'],
      win: ['Well played.', 'Steady wins it.'],
      lose: ['Deserved. Well played.'],
      opponentMiss: ['Hm.'],
    },
  },
  {
    id: 'bot.bex',
    name: 'Bank Shot Bex',
    tier: 'amateur',
    avatar: { icon: '🦉', color: '#b57bff' },
    loadout: L('cue.oak', 'balls.marble', 'table.crimson', 'fx.comet'),
    bio: 'Why go straight when there are four perfectly good cushions?',
    style: { aggression: 0.6, flair: 0.8, chatter: 0.5 },
    lines: {
      greet: ['Geometry time.', 'I hope you like angles.'],
      goodShot: ['Off the cushion, obviously.', 'Angles!', 'Physics is beautiful.'],
      miss: ['The cushion lied to me.', 'Miscalculated by a degree.'],
      foul: ['Too many angles.'],
      win: ['Q.E.D.', 'Geometry wins again.'],
      lose: ['I will draw it out and find my mistake.'],
      opponentMiss: ['Should have banked it.'],
    },
  },

  // ------------------------------------------------------------------ pros
  {
    id: 'bot.shark',
    name: 'The Shark',
    tier: 'pro',
    avatar: { icon: '🦈', color: '#4f8cff' },
    loadout: L('cue.carbon', 'balls.tv', 'table.slate', 'fx.comet'),
    bio: 'Smiles a lot. Does not miss much.',
    style: { aggression: 0.75, flair: 0.25, chatter: 0.5 },
    lines: {
      greet: ['Fancy a friendly game?', 'Just a casual one, yeah?'],
      goodShot: ['Mm-hm.', 'Swimming nicely.', 'Blood in the water.'],
      miss: ['Did not see that coming.', 'Tricky one.'],
      foul: ['Rusty tonight.'],
      win: ['Good game. Same time next week?', 'Chomp.'],
      lose: ['Well well. You can play.'],
      opponentMiss: ['I smell blood.'],
    },
  },
  {
    id: 'bot.kim',
    name: 'Cool Kim',
    tier: 'pro',
    avatar: { icon: '😎', color: '#2ed3d3' },
    loadout: L('cue.neon', 'balls.glow', 'table.arcade', 'fx.streak'),
    bio: 'The safety specialist. Leaves you nothing, then leaves.',
    style: { aggression: 0.25, flair: 0.15, chatter: 0.35 },
    lines: {
      greet: ['Let us see what you have.', 'Cool.'],
      goodShot: ['Cool.', 'As planned.'],
      miss: ['Not cool.', 'Hm.'],
      foul: ['Uncool.'],
      win: ['Stay cool.', 'Nothing personal.'],
      lose: ['Respect.'],
      opponentMiss: ['Snookered, huh?'],
    },
  },
  {
    id: 'bot.ray',
    name: 'Rocket Ray',
    tier: 'pro',
    avatar: { icon: '🚀', color: '#ff6b5a' },
    loadout: L('cue.inferno', 'balls.classic', 'table.tour', 'fx.fire'),
    bio: 'Hits everything like it owes him money.',
    style: { aggression: 0.95, flair: 0.6, chatter: 0.7 },
    lines: {
      greet: ['Stand back from the table.', 'Hope the pockets are reinforced.'],
      goodShot: ['BOOM.', 'Lift-off!', 'Hear that? That is pace.'],
      miss: ['Too much gas.', 'Overcooked it.'],
      foul: ['Worth it.'],
      win: ['Full throttle, baby.', 'Houston, we have a winner.'],
      lose: ['Next time I am hitting harder.'],
      opponentMiss: ['Should have hit it harder.'],
    },
  },

  // ------------------------------------------------------------------ masters
  {
    id: 'bot.viper',
    name: 'Viper',
    tier: 'master',
    avatar: { icon: '🐍', color: '#39d98a' },
    loadout: L('cue.ebony', 'balls.blackgold', 'table.royale', 'fx.void'),
    bio: 'Patient, precise and completely without mercy.',
    style: { aggression: 0.55, flair: 0.2, chatter: 0.4 },
    lines: {
      greet: ['Let us begin.', 'Take your time. I have plenty.'],
      goodShot: ['Sss.', 'Exactly where I wanted it.'],
      miss: ['Interesting.', 'A rare mistake.'],
      foul: ['…'],
      win: ['Checkmate.', 'You fought well.'],
      lose: ['Impressive. Truly.'],
      opponentMiss: ['Sss…'],
    },
  },
  {
    id: 'bot.professor',
    name: 'The Professor',
    tier: 'master',
    avatar: { icon: '🧙', color: '#e8e8f0' },
    loadout: L('cue.frost', 'balls.chrome', 'table.glacier', 'fx.frost'),
    bio: 'Wrote the book on cue ball control. Literally.',
    style: { aggression: 0.5, flair: 0.55, chatter: 0.6 },
    lines: {
      greet: ['Today’s lesson: position.', 'Observe carefully.'],
      goodShot: ['Note the cue ball.', 'Chapter four, page ninety.', 'Elementary.'],
      miss: ['A teachable moment.', 'Let us call that a demonstration.'],
      foul: ['Even professors err.'],
      win: ['Class dismissed.', 'Homework: study that last shot.'],
      lose: ['The student becomes the master.'],
      opponentMiss: ['Mind your follow-through.'],
    },
  },
  {
    id: 'bot.nova',
    name: 'Nova',
    tier: 'master',
    avatar: { icon: '⭐', color: '#ffc542' },
    loadout: L('cue.nebula', 'balls.planets', 'table.arcade', 'fx.party'),
    bio: 'World champion, crowd favourite, never plays the easy shot.',
    style: { aggression: 0.85, flair: 0.9, chatter: 0.7 },
    lines: {
      greet: ['Ready to put on a show?', 'Lights, camera, pool!'],
      goodShot: ['For the fans!', 'Did someone get that on camera?', 'Stellar.'],
      miss: ['The stars were not aligned.', 'Artistic licence.'],
      foul: ['Even supernovas fizzle.'],
      win: ['Thank you, thank you!', 'Another one for the highlight reel.'],
      lose: ['A new star is born.', 'You earned that. Brilliant.'],
      opponentMiss: ['My stage now.'],
    },
  },
];

const BY_ID = new Map(BOTS.map((b) => [b.id, b]));

export function botById(id: string | null | undefined): BotProfile | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function botsOfTier(tier: BotTier): BotProfile[] {
  return BOTS.filter((b) => b.tier === tier);
}

/**
 * A bot for `tier` who isn't already at the table. When the tier is used up it reaches for the
 * nearest tier rather than seating a second copy of somebody.
 */
export function pickBot(tier: BotTier, taken: string[], rand: () => number = Math.random): BotProfile {
  const want = TIER_ORDER.indexOf(tier);
  const free = BOTS.filter((b) => !taken.includes(b.id));
  if (free.length === 0) {
    const pool = botsOfTier(tier);
    return pool[Math.floor(rand() * pool.length) % pool.length];
  }
  const nearest = Math.min(...free.map((b) => Math.abs(TIER_ORDER.indexOf(b.tier) - want)));
  const pool = free.filter((b) => Math.abs(TIER_ORDER.indexOf(b.tier) - want) === nearest);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

export function botLine(bot: BotProfile, kind: BotLine, rand: () => number = Math.random): string | null {
  const lines = bot.lines[kind];
  if (!lines?.length) return null;
  return lines[Math.floor(rand() * lines.length) % lines.length];
}
