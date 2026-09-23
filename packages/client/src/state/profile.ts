import { signal, effect, computed } from '@preact/signals';
import {
  ALL_MISSIONS_BONUS,
  CATALOG,
  DEFAULT_AVATAR,
  DEFAULT_LOADOUT,
  STARTER_IDS,
  STARTING_COINS,
  cleanAvatar,
  cupById,
  dailyMissions,
  dailyStreakCoins,
  dayKey,
  daysBetween,
  itemById,
  levelForXp,
  levelUpCoins,
  matchRewards,
  resolveLoadout,
  type Avatar,
  type BotTier,
  type CosmeticItem,
  type FrameStats,
  type GameMode,
  type ItemSlot,
  type Loadout,
  type MissionDef,
  type MissionEvents,
  type RewardLine,
  type RuleSetId,
} from '@8ball/shared';
import { readJson, writeJson } from './storage';

/**
 * The player: who they are, what they own and how they are doing. Local-first and complete on
 * this device — there is no account and nothing to sync, so it works offline and costs nothing.
 * A transfer code (see `exportProfile`) moves it to another device.
 */

export interface Stats {
  games: number;
  wins: number;
  pots: number;
  shots: number;
  fouls: number;
  bestRun: number;
  bestShot: number;
  winStreak: number;
  bestWinStreak: number;
  friendGames: number;
  modeGames: Partial<Record<GameMode, number>>;
  modeWins: Partial<Record<GameMode, number>>;
}

export interface Profile {
  v: 2;
  name: string;
  avatar: Avatar;
  xp: number;
  coins: number;
  owned: string[];
  loadout: Loadout;
  stats: Stats;
  missions: { day: string; progress: Record<string, number>; claimed: string[]; bonus: boolean };
  daily: { last: string | null; streak: number };
  cupsWon: string[];
  trickStars: Record<string, number>;
  bestTimeMs: number | null;
  /** The last bot game set up, so Quick Match remembers it. */
  lastPlay: { mode: GameMode; botId: string | null; tier: BotTier; raceTo: number; ruleSet: RuleSetId };
  createdAt: number;
  veteran: boolean;
}

const KEY = '8ball:v2:profile';
const OLD_KEY = '8ball:profile';

function emptyStats(): Stats {
  return {
    games: 0,
    wins: 0,
    pots: 0,
    shots: 0,
    fouls: 0,
    bestRun: 0,
    bestShot: 0,
    winStreak: 0,
    bestWinStreak: 0,
    friendGames: 0,
    modeGames: {},
    modeWins: {},
  };
}

function fresh(): Profile {
  return {
    v: 2,
    name: '',
    avatar: { ...DEFAULT_AVATAR },
    xp: 0,
    coins: STARTING_COINS,
    owned: [...STARTER_IDS],
    loadout: { ...DEFAULT_LOADOUT },
    stats: emptyStats(),
    missions: { day: dayKey(), progress: {}, claimed: [], bonus: false },
    daily: { last: null, streak: 0 },
    cupsWon: [],
    trickStars: {},
    bestTimeMs: null,
    lastPlay: { mode: 'eightball', botId: null, tier: 'amateur', raceTo: 1, ruleSet: 'standard' },
    createdAt: Date.now(),
    veteran: false,
  };
}

/** Brings a v1 save across: name, XP, stats and trick-shot stars, plus coins for the effort. */
function migrate(): Profile | null {
  const old = readJson<Record<string, any>>(OLD_KEY);
  if (!old) return null;
  const p = fresh();
  p.name = typeof old.displayName === 'string' ? old.displayName.slice(0, 16) : '';
  p.xp = Math.max(0, Math.round(Number(old.xp) || 0));
  const games = Number(old.stats?.games) || 0;
  p.coins = STARTING_COINS + Math.min(4000, Math.round((Number(old.chalk) || 0) + games * 20));
  p.stats.games = games;
  p.stats.wins = Number(old.stats?.wins) || 0;
  p.stats.pots = Number(old.stats?.pots) || 0;
  p.stats.bestShot = Number(old.stats?.bestCombo) || 0;
  p.trickStars = { ...(old.challengeStars ?? {}) };
  p.veteran = games > 0 || p.xp > 0;
  return p;
}

function load(): Profile {
  const saved = readJson<Partial<Profile>>(KEY);
  const base = fresh();
  if (!saved) return migrate() ?? base;
  return {
    ...base,
    ...saved,
    avatar: cleanAvatar(saved.avatar),
    owned: [...new Set([...STARTER_IDS, ...(saved.owned ?? [])])].filter((id) => itemById(id)),
    loadout: resolveLoadout(saved.loadout),
    stats: { ...emptyStats(), ...(saved.stats ?? {}) },
    missions: { ...base.missions, ...(saved.missions ?? {}) },
    daily: { ...base.daily, ...(saved.daily ?? {}) },
    lastPlay: { ...base.lastPlay, ...(saved.lastPlay ?? {}) },
  };
}

export const profile = signal<Profile>(load());

effect(() => writeJson(KEY, profile.value));

export const level = computed(() => levelForXp(profile.value.xp));
export const totalTrickStars = computed(() => Object.values(profile.value.trickStars).reduce((a, b) => a + b, 0));

function update(fn: (p: Profile) => Profile | void): Profile {
  const draft = structuredClone(profile.value);
  const out = fn(draft) ?? draft;
  profile.value = out;
  return out;
}

export function displayName(): string {
  return profile.value.name.trim() || 'Player';
}

export function setName(name: string): void {
  update((p) => {
    p.name = name.replace(/\s+/g, ' ').trimStart().slice(0, 16);
  });
}

export function setAvatar(avatar: Partial<Avatar>): void {
  update((p) => {
    p.avatar = cleanAvatar({ ...p.avatar, ...avatar });
  });
}

export function owns(id: string): boolean {
  return profile.value.owned.includes(id);
}

export function equip(slot: ItemSlot, id: string): boolean {
  if (!owns(id) || itemById(id)?.slot !== slot) return false;
  update((p) => {
    p.loadout = { ...p.loadout, [slot]: id };
  });
  return true;
}

export type BuyResult = 'ok' | 'owned' | 'locked' | 'poor';

export function buy(id: string): BuyResult {
  const item = itemById(id);
  if (!item) return 'locked';
  if (owns(id)) return 'owned';
  if (item.unlock.kind !== 'coins') return 'locked';
  const price = item.unlock.price;
  if (profile.value.coins < price) return 'poor';
  update((p) => {
    p.coins -= price;
    p.owned.push(id);
  });
  return 'ok';
}

/** Hands over every item whose condition is now met. Returns what was new. */
export function grantEarnedItems(): CosmeticItem[] {
  const p = profile.value;
  const lvl = levelForXp(p.xp);
  const stars = Object.values(p.trickStars).reduce((a, b) => a + b, 0);
  const earned = CATALOG.filter((item) => {
    if (p.owned.includes(item.id)) return false;
    const u = item.unlock;
    if (u.kind === 'level') return lvl >= u.level;
    if (u.kind === 'stars') return stars >= u.stars;
    if (u.kind === 'cup') return p.cupsWon.includes(u.cupId);
    return false;
  });
  if (earned.length) update((d) => void d.owned.push(...earned.map((i) => i.id)));
  return earned;
}

export interface Progression {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  levelCoins: number;
  unlocked: CosmeticItem[];
}

/** Adds XP and coins, paying out level-ups and any items that unlock along the way. */
export function award(xp: number, coins: number): Progression {
  const before = levelForXp(profile.value.xp);
  let levelCoins = 0;
  update((p) => {
    p.xp += Math.max(0, Math.round(xp));
    p.coins += Math.max(0, Math.round(coins));
    const after = levelForXp(p.xp);
    for (let l = before + 1; l <= after; l++) levelCoins += levelUpCoins(l);
    p.coins += levelCoins;
  });
  const after = levelForXp(profile.value.xp);
  return { xp, coins, levelBefore: before, levelAfter: after, levelCoins, unlocked: grantEarnedItems() };
}

// ------------------------------------------------------------------ missions

/** Today's missions, rolling the day over if needed. */
export function todaysMissions(): MissionDef[] {
  const today = dayKey();
  if (profile.value.missions.day !== today) {
    update((p) => {
      p.missions = { day: today, progress: {}, claimed: [], bonus: false };
    });
  }
  return dailyMissions(today);
}

export function missionProgress(def: MissionDef): number {
  return Math.min(def.target, profile.value.missions.progress[def.id] ?? 0);
}

function countMissions(events: MissionEvents): MissionDef[] {
  const missions = todaysMissions();
  const completed: MissionDef[] = [];
  update((p) => {
    for (const m of missions) {
      const add = events[m.metric] ?? 0;
      if (!add) continue;
      const before = p.missions.progress[m.id] ?? 0;
      const after = Math.min(m.target, before + add);
      p.missions.progress[m.id] = after;
      if (before < m.target && after >= m.target) completed.push(m);
    }
  });
  return completed;
}

export function claimMission(id: string): Progression | null {
  const def = todaysMissions().find((m) => m.id === id);
  if (!def || missionProgress(def) < def.target || profile.value.missions.claimed.includes(id)) return null;
  update((p) => void p.missions.claimed.push(id));
  return award(def.xp, def.coins);
}

export function canClaimBonus(): boolean {
  const m = profile.value.missions;
  return !m.bonus && todaysMissions().every((d) => m.claimed.includes(d.id));
}

export function claimBonus(): Progression | null {
  if (!canClaimBonus()) return null;
  update((p) => void (p.missions.bonus = true));
  return award(ALL_MISSIONS_BONUS.xp, ALL_MISSIONS_BONUS.coins);
}

// ------------------------------------------------------------------ daily reward

export function dailyAvailable(): boolean {
  return profile.value.daily.last !== dayKey();
}

/** The streak day a claim today would count as. */
export function nextStreakDay(): number {
  const { last, streak } = profile.value.daily;
  if (!last) return 1;
  const gap = daysBetween(last, dayKey());
  return gap === 1 ? streak + 1 : gap === 0 ? streak : 1;
}

export function claimDaily(): { day: number; coins: number } | null {
  if (!dailyAvailable()) return null;
  const day = nextStreakDay();
  const coins = dailyStreakCoins(day);
  update((p) => {
    p.daily = { last: dayKey(), streak: day };
  });
  award(0, coins);
  return { day, coins };
}

// ------------------------------------------------------------------ results

export interface MatchReport {
  mode: GameMode;
  won: boolean;
  /** Toughest bot faced, or null against people only. */
  botTier: BotTier | null;
  versusHumans: boolean;
  raceTo: number;
  stats: FrameStats;
  multiPots: number;
  kickPots: number;
  jumpPots: number;
  orbs: number;
  cupId: string | null;
  champion: boolean;
}

export interface RewardSummary {
  lines: RewardLine[];
  progression: Progression;
  missions: MissionDef[];
  cup: { name: string; coins: number; xp: number; item: CosmeticItem | null } | null;
}

export function recordMatch(r: MatchReport): RewardSummary {
  const rewards = matchRewards({
    mode: r.mode,
    won: r.won,
    botTier: r.botTier,
    versusHumans: r.versusHumans,
    pots: r.stats.pots,
    raceTo: r.raceTo,
    clean: r.stats.fouls === 0,
    bestRun: r.stats.bestRun,
  });

  update((p) => {
    const s = p.stats;
    s.games++;
    s.pots += r.stats.pots;
    s.shots += r.stats.shots;
    s.fouls += r.stats.fouls;
    s.bestRun = Math.max(s.bestRun, r.stats.bestRun);
    s.bestShot = Math.max(s.bestShot, r.stats.bestShot);
    s.modeGames[r.mode] = (s.modeGames[r.mode] ?? 0) + 1;
    if (r.versusHumans) s.friendGames++;
    if (r.won) {
      s.wins++;
      s.winStreak++;
      s.bestWinStreak = Math.max(s.bestWinStreak, s.winStreak);
      s.modeWins[r.mode] = (s.modeWins[r.mode] ?? 0) + 1;
    } else {
      s.winStreak = 0;
    }
  });

  let cup: RewardSummary['cup'] = null;
  let extraXp = 0;
  let extraCoins = 0;
  const cupDef = cupById(r.cupId);
  if (cupDef && r.champion) {
    const first = !profile.value.cupsWon.includes(cupDef.id);
    if (first) update((p) => void p.cupsWon.push(cupDef.id));
    extraXp = first ? cupDef.reward.xp : Math.round(cupDef.reward.xp / 3);
    extraCoins = first ? cupDef.reward.coins : Math.round(cupDef.reward.coins / 3);
    cup = {
      name: cupDef.name,
      coins: extraCoins,
      xp: extraXp,
      item: first && cupDef.reward.item ? (itemById(cupDef.reward.item) ?? null) : null,
    };
  }

  const missions = countMissions({
    games: 1,
    wins: r.won ? 1 : 0,
    pots: r.stats.pots,
    nineballWins: r.won && r.mode === 'nineball' ? 1 : 0,
    killerWins: r.won && r.mode === 'killer' ? 1 : 0,
    powerWins: r.won && r.mode === 'power' ? 1 : 0,
    multiPots: r.multiPots,
    runs4: r.stats.bestRun >= 4 ? 1 : 0,
    kickPots: r.kickPots,
    cleanWins: r.won && r.stats.fouls === 0 ? 1 : 0,
    jumpPots: r.jumpPots,
    proWins: r.won && (r.botTier === 'pro' || r.botTier === 'master') ? 1 : 0,
    orbs: r.orbs,
    friendGames: r.versusHumans ? 1 : 0,
  });

  const progression = award(rewards.xp + extraXp, rewards.coins + extraCoins);
  return { lines: rewards.lines, progression, missions, cup };
}

export interface SoloReport {
  kind: 'trick' | 'time';
  challengeId: string | null;
  stars: number;
  timeMs: number | null;
  pots: number;
}

export function recordSolo(r: SoloReport): RewardSummary & { improved: boolean } {
  let improved = false;
  let firstClearCoins = 0;
  let firstClearXp = 0;
  const lines: RewardLine[] = [];
  update((p) => {
    p.stats.pots += r.pots;
    if (r.kind === 'trick' && r.challengeId) {
      const before = p.trickStars[r.challengeId] ?? 0;
      if (r.stars > before) {
        improved = true;
        p.trickStars[r.challengeId] = r.stars;
        // Coins for each new star, more for the first clear.
        firstClearCoins = (r.stars - before) * 40 + (before === 0 ? 60 : 0);
        firstClearXp = (r.stars - before) * 50;
      }
    }
    if (r.kind === 'time' && r.timeMs !== null) {
      if (p.bestTimeMs === null || r.timeMs < p.bestTimeMs) {
        improved = true;
        p.bestTimeMs = r.timeMs;
      }
    }
  });
  if (r.kind === 'trick' && improved) lines.push({ label: 'New stars', xp: firstClearXp, coins: firstClearCoins });
  if (r.kind === 'time' && r.timeMs !== null) {
    lines.push({ label: 'Run cleared', xp: 80 + r.stars * 30, coins: 30 + r.stars * 20 });
    if (improved) lines.push({ label: 'Personal best', xp: 60, coins: 50 });
  }
  const xp = lines.reduce((s, l) => s + l.xp, 0);
  const coins = lines.reduce((s, l) => s + l.coins, 0);
  const newStars = r.kind === 'trick' ? r.stars : 0;
  const missions = countMissions({
    pots: r.pots,
    trickStars: improved ? newStars : 0,
    timeAttackClears: r.kind === 'time' && r.timeMs !== null ? 1 : 0,
  });
  const progression = award(xp, coins);
  return { lines, progression, missions, cup: null, improved };
}

export function rememberPlay(lastPlay: Profile['lastPlay']): void {
  update((p) => void (p.lastPlay = lastPlay));
}

// ------------------------------------------------------------------ transfer

/** A copyable code holding the whole profile, for moving to another device. */
export function exportProfile(): string {
  const json = JSON.stringify(profile.value);
  return btoa(unescape(encodeURIComponent(json)));
}

export function importProfile(code: string): boolean {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const data = JSON.parse(json) as Partial<Profile>;
    if (data.v !== 2 || typeof data.xp !== 'number') return false;
    writeJson(KEY, data);
    profile.value = load();
    return true;
  } catch {
    return false;
  }
}

export function resetProfile(): void {
  profile.value = fresh();
}
