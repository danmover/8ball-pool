import { icon, type IconName } from './icons';
import { rewardChips, type Reward } from '../profile/rewards';

/**
 * One place anything gets announced.
 *
 * The table used to say things in four unrelated ways, all of them at the top of the screen
 * and two of them at literally overlapping coordinates:
 *
 *   - `.turn-flourish`  in `.centre-hud` at `top: 84px`  — whose shot it is
 *   - `.foul-note`      in `.centre-hud` underneath it   — why the last shot ended
 *   - `.toast-stack`    fixed at `top: 96px`             — toasts, and shot callouts
 *   - `.combo-callout`  fixed at `top: 34%`              — DOUBLE! / TRIPLE! / GAME!
 *
 * So a combo on a shot that also fouled, on the turn it handed over, put four separate
 * objects on screen from four separate systems, one of them painted straight through
 * another. Each had its own markup, its own animation, its own idea of how long a thing
 * should stay, and its own (or no) accessibility story.
 *
 * This is all of it. One rail, three lanes down a single column so nothing can ever land on
 * top of anything else, one queue with one notion of what outranks what, and one live region
 * so the running commentary of a frame is actually readable by a screen reader.
 *
 *   herald — one at a time, big, transient. The moment: a turn arriving, a combo, GAME!
 *   pinned — at most one, stays put. The state: why you have ball in hand.
 *   feed   — up to three compact notes. The log: rewards, errors, someone disconnecting.
 *
 * The lanes are ordered by how much they matter rather than by when they arrived, which is
 * the other half of why the old version read as noise: a disconnect toast could sit above
 * the announcement of your own turn purely because it got there first.
 */

export type NoticeKind = 'info' | 'foul' | 'reward' | 'turn' | 'feat' | 'hype';

interface KindSpec {
  lane: 'herald' | 'feed';
  /** The leading mark. Heralds carry their own weight and take none. */
  icon: IconName | null;
  /** How long it holds before it leaves. */
  ms: number;
  /** Who wins when two want the same space. */
  weight: number;
  /** Worth interrupting a screen reader for. */
  urgent?: boolean;
}

const KINDS: Record<NoticeKind, KindSpec> = {
  info: { lane: 'feed', icon: 'target', ms: 2600, weight: 1 },
  reward: { lane: 'feed', icon: 'star', ms: 3600, weight: 2 },
  foul: { lane: 'feed', icon: 'close', ms: 3400, weight: 3, urgent: true },
  turn: { lane: 'herald', icon: null, ms: 2100, weight: 1 },
  feat: { lane: 'herald', icon: null, ms: 2400, weight: 2 },
  hype: { lane: 'herald', icon: null, ms: 1300, weight: 3 },
};

/** The feed never grows past this. A run of fouls must not paper over the table. */
const FEED_MAX = 3;

/*
 * The rules about what outranks what, as plain functions.
 *
 * They are separate from the rendering on purpose. This is the part of the module with actual
 * decisions in it — which of two announcements gets the lane, which note is sacrificed when
 * the feed is full — and it is the part worth being sure about. Tangled into element building
 * it could only be checked by looking at a screen.
 */

/** What lane a kind belongs in, how long it holds, and what it takes to shift it. */
export function noticeSpec(kind: NoticeKind): Readonly<KindSpec> {
  return KINDS[kind];
}

/**
 * How hard a herald is to shift.
 *
 * Scale is the combo tier, which is why it counts: a five-ball run has to outrank the turn
 * banner that follows it, and GAME! has to outrank everything.
 */
export function heraldWeight(kind: NoticeKind, scale = 1): number {
  return KINDS[kind].weight + (scale - 1);
}

/**
 * Does the incoming herald get the lane?
 *
 * Ties go to the newcomer — it is the more recent moment, and two announcements of equal
 * importance should read as the second replacing the first rather than the first winning by
 * having arrived. An empty lane always yields.
 */
export function heraldWins(incoming: number, current: number | null): boolean {
  return current === null || incoming >= current;
}

/** Same key, same notice. Defaults to the kind and the words, so exact repeats fold for free. */
export function noticeKey(kind: NoticeKind, message: string, key?: string): string {
  return key ?? `${kind}:${message}`;
}

/**
 * Which note goes when the feed is full: the least important one, and the oldest of those.
 *
 * Not simply the oldest. Dropping the reason you have ball in hand to make room for "opponent
 * reconnected" is how a log stops being worth reading, and a plain FIFO does exactly that
 * whenever three things happen at once — which, at the end of a shot, they routinely do.
 */
export function evictionIndex(weights: readonly number[]): number {
  let worst = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] < weights[worst]) worst = i;
  }
  return worst;
}

/** Escapes text going into a notice. Names come from other players; messages from the server. */
export function escapeNotice(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

export interface NoticeOptions {
  kind?: NoticeKind;
  /** The second line: the why, the detail, the consequence. */
  detail?: string;
  /** Override the kind's mark. `null` draws none. */
  icon?: IconName | null;
  /** What it pays, drawn as the same chips every other screen uses. */
  reward?: Reward;
  /** How long it holds. Ignored when pinned. */
  ms?: number;
  /**
   * Same key, same notice: it refreshes in place with a `×N` tally rather than stacking a
   * second copy. Defaults to the message, so repeating something identical is free.
   */
  key?: string;
  /** Stays until it is replaced or cleared. There is only ever one pinned notice. */
  pinned?: boolean;
  /** The loud variant — your own turn rather than somebody else's. */
  strong?: boolean;
  /** Size multiplier for a herald. Also raises what it takes to interrupt it. */
  scale?: number;
}

export interface MountOptions {
  /**
   * Position the rail itself, fixed under the top of the window. Menu screens want this;
   * the table does not, because there the rail is a row in the centre column and the shot
   * clock has to flow underneath whatever is currently being said.
   */
  floating?: boolean;
}

interface FeedNote {
  el: HTMLElement;
  key: string;
  weight: number;
  count: number;
  timer: number;
}

export class NoticeCentre {
  private rail: HTMLElement;
  private heraldLane: HTMLElement;
  private pinLane: HTMLElement;
  private feedLane: HTMLElement;
  private live: HTMLElement;

  private feed: FeedNote[] = [];
  private heraldRank: number | null = null;
  private heraldTimer = 0;
  private disposed = false;

  constructor(host: HTMLElement, opts: MountOptions = {}) {
    this.rail = document.createElement('div');
    this.rail.className = `notice-rail${opts.floating ? ' floating' : ''}`;
    /*
     * One live region for the lot, and it is in the document before anything is put into it —
     * a region announced into on the same tick it is created is a region nobody hears.
     */
    this.rail.innerHTML = `
      <div class="notice-herald-lane"></div>
      <div class="notice-pin-lane"></div>
      <div class="notice-feed-lane"></div>
      <span class="notice-live" role="status" aria-live="polite"></span>`;

    this.heraldLane = this.rail.querySelector('.notice-herald-lane')!;
    this.pinLane = this.rail.querySelector('.notice-pin-lane')!;
    this.feedLane = this.rail.querySelector('.notice-feed-lane')!;
    this.live = this.rail.querySelector('.notice-live')!;
    host.appendChild(this.rail);
  }

  /** Says something. Routed to a lane by its kind; returns nothing to wait on. */
  show(message: string, opts: NoticeOptions = {}): void {
    if (this.disposed || !message) return;
    const kind = opts.kind ?? 'info';
    const spec = KINDS[kind];

    this.announce(message, opts.detail, spec.urgent ?? false);

    if (opts.pinned) {
      this.paintPin(message, opts, kind);
      return;
    }
    if (spec.lane === 'herald') this.pushHerald(message, opts, kind, spec);
    else this.pushFeed(message, opts, kind, spec);
  }

  /** The state you are in until you do something about it. Replaces whatever was pinned. */
  pin(message: string, opts: NoticeOptions = {}): void {
    this.show(message, { ...opts, pinned: true });
  }

  clearPin(): void {
    this.pinLane.replaceChildren();
  }

  /** Everything down, now — a frame ending, a page leaving. */
  clear(): void {
    for (const note of this.feed) clearTimeout(note.timer);
    this.feed = [];
    clearTimeout(this.heraldTimer);
    this.heraldRank = null;
    this.heraldLane.replaceChildren();
    this.pinLane.replaceChildren();
    this.feedLane.replaceChildren();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
    this.rail.remove();
  }

  // ---- Lanes ----

  /**
   * A herald is a moment, not a log. A new one interrupts rather than queues: an announcement
   * that waits its turn arrives after the thing it was announcing, which is worse than not
   * arriving at all. Weight decides the argument, so GAME! is never shoved aside by the turn
   * change that follows it.
   */
  private pushHerald(message: string, opts: NoticeOptions, kind: NoticeKind, spec: KindSpec): void {
    void spec;
    const scale = opts.scale ?? 1;
    const rank = heraldWeight(kind, scale);
    if (this.heraldLane.firstElementChild && !heraldWins(rank, this.heraldRank)) return;

    const ms = opts.ms ?? spec.ms;
    const el = document.createElement('div');
    el.className = `ntc-herald ntc-${kind}${opts.strong ? ' is-strong' : ''}`;
    el.style.setProperty('--hold', `${ms}ms`);
    if (scale !== 1) el.style.setProperty('--ntc-scale', String(scale));
    el.innerHTML = `
      <span class="ntc-herald-text">${escapeNotice(message)}</span>
      ${opts.detail ? `<span class="ntc-herald-detail">${escapeNotice(opts.detail)}</span>` : ''}
      ${opts.reward ? rewardChips(opts.reward) : ''}`;

    this.heraldLane.replaceChildren(el);
    this.heraldRank = rank;

    clearTimeout(this.heraldTimer);
    this.heraldTimer = window.setTimeout(() => {
      this.heraldRank = null;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  private paintPin(message: string, opts: NoticeOptions, kind: NoticeKind): void {
    const el = document.createElement('div');
    el.className = `ntc ntc-pinned ntc-${kind}`;
    el.innerHTML = this.noteInner(message, opts, kind);
    this.pinLane.replaceChildren(el);
  }

  /**
   * The feed. Identical notes fold together with a tally instead of stacking, and when it is
   * full the *least important* note goes rather than simply the oldest — losing the reason
   * you fouled to make room for "opponent reconnected" is how a log stops being worth reading.
   */
  private pushFeed(message: string, opts: NoticeOptions, kind: NoticeKind, spec: KindSpec): void {
    const key = noticeKey(kind, message, opts.key);
    const ms = opts.ms ?? spec.ms;

    const existing = this.feed.find((n) => n.key === key);
    if (existing) {
      existing.count++;
      const tally = existing.el.querySelector<HTMLElement>('.ntc-tally')!;
      tally.textContent = `×${existing.count}`;
      tally.hidden = false;
      // Off, reflow, on — or the second one through silently plays nothing.
      existing.el.classList.remove('bumped');
      void existing.el.offsetWidth;
      existing.el.classList.add('bumped');
      this.restart(existing, ms);
      return;
    }

    const el = document.createElement('div');
    el.className = `ntc ntc-${kind}`;
    el.style.setProperty('--hold', `${ms}ms`);
    el.innerHTML = `${this.noteInner(message, opts, kind)}<span class="ntc-hold"></span>`;

    const note: FeedNote = { el, key, weight: spec.weight, count: 1, timer: 0 };
    this.feedLane.appendChild(el);
    this.feed.push(note);
    this.restart(note, ms);

    while (this.feed.length > FEED_MAX) {
      this.drop(this.feed[evictionIndex(this.feed.map((n) => n.weight))]);
    }
  }

  private noteInner(message: string, opts: NoticeOptions, kind: NoticeKind): string {
    const mark = opts.icon === undefined ? KINDS[kind].icon : opts.icon;
    return `
      ${mark ? `<span class="ntc-mark">${icon(mark, { size: 17 })}</span>` : ''}
      <span class="ntc-body">
        <span class="ntc-title">${escapeNotice(message)}</span>
        ${opts.detail ? `<span class="ntc-detail">${escapeNotice(opts.detail)}</span>` : ''}
        ${opts.reward ? rewardChips(opts.reward) : ''}
      </span>
      <span class="ntc-tally" hidden></span>`;
  }

  private restart(note: FeedNote, ms: number): void {
    clearTimeout(note.timer);
    const hold = note.el.querySelector<HTMLElement>('.ntc-hold');
    if (hold) {
      hold.style.animation = 'none';
      void hold.offsetWidth;
      hold.style.animation = '';
    }
    note.timer = window.setTimeout(() => this.drop(note), ms);
  }

  private drop(note: FeedNote): void {
    clearTimeout(note.timer);
    this.feed = this.feed.filter((n) => n !== note);
    note.el.classList.add('leaving');
    setTimeout(() => note.el.remove(), 240);
  }

  /**
   * The commentary, out loud.
   *
   * A foul interrupts and everything else waits its turn — that distinction is the entire
   * reason `assertive` exists, and having it backwards is how a page starts talking over
   * itself. Back to polite straight after, so an ordinary note does not cut in later.
   */
  private announce(message: string, detail: string | undefined, urgent: boolean): void {
    if (urgent) this.live.setAttribute('aria-live', 'assertive');
    this.live.textContent = detail ? `${message}. ${detail}` : message;
    if (urgent) setTimeout(() => this.live.setAttribute('aria-live', 'polite'), 120);
  }
}

/**
 * One centre per host element, so a page that asks twice gets the same rail rather than two
 * of them stacked — which is the failure mode this whole module exists to end.
 */
const CENTRES = new WeakMap<HTMLElement, NoticeCentre>();

export function mountNotices(host: HTMLElement, opts: MountOptions = {}): NoticeCentre {
  const existing = CENTRES.get(host);
  if (existing) return existing;
  const centre = new NoticeCentre(host, opts);
  CENTRES.set(host, centre);
  return centre;
}
