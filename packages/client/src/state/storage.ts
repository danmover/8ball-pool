/**
 * localStorage that never throws. Private windows, full disks and blocked storage all degrade to
 * "nothing saved" rather than a broken page.
 */
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** A stable random id for this device, used as its peer id on the relay. */
export function devicePeerId(): string {
  const key = '8ball:v2:peer';
  const existing = readJson<string>(key);
  if (existing && /^[A-Za-z0-9_-]{8,40}$/.test(existing)) return existing;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  writeJson(key, id);
  return id;
}
