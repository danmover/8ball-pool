import { LocalProfileStore, type Profile, type ProfileStore } from './profileStore';

/**
 * A profile that lives on the server but never makes you wait for it.
 *
 * `ProfileStore.load()` is synchronous and called from everywhere — the menu, the locker, the
 * middle of a frame. Making it async would mean touching every call site and, worse, leaving
 * the UI with nothing to draw while a request is in flight. So this is **local-first**: reads
 * and writes hit localStorage immediately, and the server is reconciled in the background.
 *
 * That choice also buys offline play for nothing. If the server is unreachable the game is
 * exactly as playable as it was before any of this existed, and syncs when it comes back — a
 * game that refused to start because a database was down would be a clear step backwards.
 *
 * Conflicts are resolved by revision, last writer wins. Playing one profile on two devices at
 * once isn't a supported thing to do; the transfer code is for *moving* a profile, not sharing
 * one. What the revision check does buy is the important case: a device that has been offline
 * for a week cannot flatten a week of play when it reconnects.
 */

const TOKEN_KEY = '8ball:profileToken';
const REVISION_KEY = '8ball:profileRevision';
const MIGRATED_KEY = '8ball:profileMigrated';

/** How long to sit on changes before pushing them, so a burst of pots is one request. */
const PUSH_DEBOUNCE_MS = 1500;

export interface SyncStatus {
  state: 'offline' | 'syncing' | 'synced' | 'error';
  /** True once the server copy has been merged in, so callers know the profile is settled. */
  hydrated: boolean;
}

export class SyncedProfileStore implements ProfileStore {
  private local = new LocalProfileStore();
  private baseUrl: string;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private status: SyncStatus = { state: 'offline', hydrated: false };
  private statusListeners = new Set<(s: SyncStatus) => void>();
  /** Called when the server hands back a profile that should replace what's on screen. */
  private onAdopt: ((profile: Profile) => void) | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  // ---- ProfileStore (synchronous, always local) ----

  load(): Profile {
    return this.local.load();
  }

  save(profile: Profile): void {
    this.local.save(profile);
    this.schedulePush();
  }

  // ---- Sync ----

  onStatusChange(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.statusListeners) l(this.status);
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private get revision(): number {
    return Number(localStorage.getItem(REVISION_KEY) ?? 0);
  }

  private set revision(value: number) {
    localStorage.setItem(REVISION_KEY, String(value));
  }

  /**
   * Brings the local copy and the server into agreement, once, at boot.
   *
   * On a device with no token this uploads whatever is already in localStorage rather than
   * discarding it — someone who has been playing offline for a month should not be handed a
   * fresh profile the first time the server appears.
   */
  async hydrate(adopt: (profile: Profile) => void): Promise<void> {
    this.onAdopt = adopt;
    this.setStatus({ state: 'syncing' });

    try {
      if (!this.token) {
        await this.createRemote();
      } else {
        const res = await fetch(`${this.baseUrl}/api/profile`, {
          headers: { authorization: `Bearer ${this.token}` },
        });
        if (res.status === 404) {
          // Token points at nothing — the database was reset, or this is a different server.
          // Start again rather than getting stuck unable to sync.
          localStorage.removeItem(TOKEN_KEY);
          await this.createRemote();
        } else if (res.ok) {
          const body = (await res.json()) as { profile: Profile; revision: number };
          if (body.revision > this.revision) {
            this.local.save(body.profile);
            this.revision = body.revision;
            adopt(body.profile);
          } else if (body.revision < this.revision) {
            // We're ahead — push instead of pulling.
            this.revision = body.revision;
            this.schedulePush(0);
          }
        }
      }
      this.setStatus({ state: 'synced', hydrated: true });
    } catch {
      // Unreachable server is a normal state, not an error worth shouting about.
      this.setStatus({ state: 'offline', hydrated: true });
    }
  }

  private async createRemote(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Upload what's already here, so offline progress survives first contact with the
      // server rather than being replaced by a fresh profile.
      body: JSON.stringify({ profile: this.local.load() }),
    });
    if (!res.ok) throw new Error(`profile create failed: ${res.status}`);
    const body = (await res.json()) as { token: string; revision: number };
    localStorage.setItem(TOKEN_KEY, body.token);
    localStorage.setItem(MIGRATED_KEY, '1');
    this.revision = body.revision;
  }

  private schedulePush(delay = PUSH_DEBOUNCE_MS): void {
    if (!this.token) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), delay);
  }

  private async push(): Promise<void> {
    this.pushTimer = null;
    if (this.pushing || !this.token) return;
    this.pushing = true;
    this.setStatus({ state: 'syncing' });

    try {
      const res = await fetch(`${this.baseUrl}/api/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ profile: this.local.load(), revision: this.revision }),
      });

      if (res.status === 409) {
        // Someone else wrote first. Take theirs — see the note on conflicts above — and let the
        // UI redraw rather than leaving two versions of the truth on screen.
        const body = (await res.json()) as { profile: Profile; revision: number };
        this.local.save(body.profile);
        this.revision = body.revision;
        this.onAdopt?.(body.profile);
      } else if (res.ok) {
        const body = (await res.json()) as { revision: number };
        this.revision = body.revision;
      }
      this.setStatus({ state: 'synced' });
    } catch {
      this.setStatus({ state: 'offline' });
      // No retry loop: the next save schedules another push, and hydrate() catches up on boot.
    } finally {
      this.pushing = false;
    }
  }

  /** Issues a code to type into another device. */
  async createTransferCode(): Promise<{ code: string; expiresAt: number }> {
    if (!this.token) throw new Error('no profile to transfer');
    // Make sure the other device gets everything, not everything-but-the-last-few-seconds.
    await this.push();
    const res = await fetch(`${this.baseUrl}/api/profile/transfer`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error('could not create a transfer code');
    return (await res.json()) as { code: string; expiresAt: number };
  }

  /** Adopts the profile a code points at, replacing whatever is on this device. */
  async claimTransferCode(code: string): Promise<Profile> {
    const res = await fetch(`${this.baseUrl}/api/profile/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('That code is not valid, or it has expired.');
    const body = (await res.json()) as { token: string; profile: Profile; revision: number };
    localStorage.setItem(TOKEN_KEY, body.token);
    localStorage.setItem(MIGRATED_KEY, '1');
    this.revision = body.revision;
    this.local.save(body.profile);
    this.onAdopt?.(body.profile);
    return body.profile;
  }
}
