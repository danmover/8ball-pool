import { getSocket } from './socket';
import { getProfile } from '../profile/profile';

/**
 * Telling the server who this is.
 *
 * Reuses the profile token — the same opaque string the profile store already keeps — so there
 * is one identity rather than two. Everything ranked hangs off it: the server writes ratings
 * against this token from frames it refereed, and never asks the client what its rating is.
 *
 * Playing without one is allowed and works completely normally. It just does not count.
 */

const TOKEN_KEY = '8ball:profileToken';

export interface RankedIdentity {
  rating: number;
  frames: number;
  provisional: boolean;
  tier: string;
}

let cached: RankedIdentity | null = null;
let sent = false;

export function profileToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** The last rating the server told us. Display only — nothing is decided from this. */
export function rankedIdentity(): RankedIdentity | null {
  return cached;
}

/**
 * Sends the identity once per session, and again whenever the socket reconnects.
 *
 * Idempotent, because several pages call it on mount and there is no harm in the server being
 * told twice.
 */
export function identify(): Promise<RankedIdentity | null> {
  const token = profileToken();
  if (!token) return Promise.resolve(null);

  const socket = getSocket();
  if (!sent) {
    sent = true;
    // A reconnect gets a fresh socket on the server, which knows nothing about us until we say
    // so again — otherwise a dropped connection quietly stops your frames counting.
    socket.on('connect', () => {
      const t = profileToken();
      if (t) socket.emit('identify', { token: t, name: getProfile().displayName || 'Player' }, (res) => {
        cached = res;
      });
    });
  }

  return new Promise((resolve) => {
    socket.emit('identify', { token, name: getProfile().displayName || 'Player' }, (res) => {
      cached = res;
      resolve(res);
    });
  });
}

export function formatRating(id: RankedIdentity | null): string {
  if (!id) return 'Unranked';
  // A provisional number presented as a rating is a default dressed as a measurement.
  return id.provisional ? `${id.tier} · placing` : `${id.tier} · ${id.rating}`;
}
