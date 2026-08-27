/**
 * Where a player's profile lives once it stops living only in their browser.
 *
 * The profile itself is stored as an **opaque JSON blob**. The server has no opinion about
 * what's inside it — that schema belongs to the client, and coupling the two would mean a
 * server deploy every time a cosmetic slot is added.
 *
 * Worth being straight about what this is and isn't. It makes progress follow you between
 * devices; it does **not** make the economy tamper-proof. Genuine authority would mean the
 * server owning how XP and chalk are earned and spent, which means moving progression rules
 * out of the client and validating every award against a match it refereed. That's a separate
 * piece of work, and claiming it here would be a lie.
 */

export interface StoredProfile {
  /** The client's profile object, verbatim. */
  data: unknown;
  /**
   * Bumped on every write. A save that arrives with a stale revision is rejected rather than
   * silently overwriting a newer one — which is what stops a device that has been offline for
   * a week from wiping a week of play when it reconnects.
   */
  revision: number;
  updatedAt: number;
}

export interface ProfileRepository {
  /** Creates a new profile and returns its access token. */
  create(data: unknown): { token: string; stored: StoredProfile };
  get(token: string): StoredProfile | null;
  /** Returns the new revision, or null if `expectedRevision` was stale. */
  save(token: string, data: unknown, expectedRevision: number): StoredProfile | null;
  /** Issues a short-lived code that lets another device adopt this profile. */
  createTransferCode(token: string): { code: string; expiresAt: number } | null;
  /** Redeems a transfer code, returning the token it points at. */
  redeemTransferCode(code: string): string | null;
  close(): void;
}

/** How long a transfer code stays valid. Long enough to type it out, short enough to be safe. */
export const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

/** Rejects absurd payloads before they reach the database. */
export const MAX_PROFILE_BYTES = 64 * 1024;
