import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import {
  TRANSFER_CODE_TTL_MS,
  type ProfileRepository,
  type StoredProfile,
} from './repository.js';

/**
 * SQLite-backed profiles, using Node's built-in `node:sqlite`.
 *
 * Built-in on purpose: `better-sqlite3` is a native module, and a native module in a workspace
 * that also has to build on a fresh CI runner is a recurring source of "works on my machine".
 * This needs nothing installed.
 *
 * **Deployment note.** The default path is a file, and a file on a container with an ephemeral
 * filesystem — which is what Render's free tier gives you — is wiped on every redeploy. That is
 * a hosting decision, not a code one: point `PROFILE_DB_PATH` at a mounted disk, or write a
 * Postgres implementation of `ProfileRepository`, which is the reason the interface exists.
 */

/**
 * Loaded through `createRequire` rather than a static import.
 *
 * `node:sqlite` is newer than the list of Node builtins baked into the bundled Vite, so a
 * static import gets rewritten to a bare "sqlite" specifier and fails to resolve under the
 * test runner — marking it external doesn't help, because the loader still tries. Fetching it
 * at runtime is invisible to the transform and behaves identically at run time.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** Transfer codes people have to read aloud, so no 0/O or 1/I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export class SqliteProfileRepository implements ProfileRepository {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(path = process.env.PROFILE_DB_PATH ?? 'profiles.db') {
    this.db = new DatabaseSync(path);
    // WAL keeps reads from blocking behind a write, which matters because every save from
    // every device lands here.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        token TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_codes (
        code TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  create(data: unknown): { token: string; stored: StoredProfile } {
    const token = randomBytes(24).toString('base64url');
    const stored: StoredProfile = { data, revision: 1, updatedAt: Date.now() };
    this.db
      .prepare('INSERT INTO profiles (token, data, revision, updated_at) VALUES (?, ?, ?, ?)')
      .run(token, JSON.stringify(data), stored.revision, stored.updatedAt);
    return { token, stored };
  }

  get(token: string): StoredProfile | null {
    const row = this.db
      .prepare('SELECT data, revision, updated_at FROM profiles WHERE token = ?')
      .get(token) as { data: string; revision: number; updated_at: number } | undefined;
    if (!row) return null;
    return { data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at };
  }

  save(token: string, data: unknown, expectedRevision: number): StoredProfile | null {
    const current = this.get(token);
    if (!current) return null;
    // Stale write: the caller has been away and something newer is already here. Refusing is
    // the whole point — a device back from a week offline must not flatten a week of play.
    if (expectedRevision !== current.revision) return null;

    const stored: StoredProfile = {
      data,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    this.db
      .prepare('UPDATE profiles SET data = ?, revision = ?, updated_at = ? WHERE token = ?')
      .run(JSON.stringify(data), stored.revision, stored.updatedAt, token);
    return stored;
  }

  createTransferCode(token: string): { code: string; expiresAt: number } | null {
    if (!this.get(token)) return null;
    this.purgeExpiredCodes();
    const code = randomCode(6);
    const expiresAt = Date.now() + TRANSFER_CODE_TTL_MS;
    this.db
      .prepare('INSERT OR REPLACE INTO transfer_codes (code, token, expires_at) VALUES (?, ?, ?)')
      .run(code, token, expiresAt);
    return { code, expiresAt };
  }

  redeemTransferCode(code: string): string | null {
    this.purgeExpiredCodes();
    const row = this.db
      .prepare('SELECT token FROM transfer_codes WHERE code = ?')
      .get(code.toUpperCase()) as { token: string } | undefined;
    if (!row) return null;
    // Single use: a code that stayed valid after being read out loud is a code that lets
    // anyone who overheard it take the profile.
    this.db.prepare('DELETE FROM transfer_codes WHERE code = ?').run(code.toUpperCase());
    return row.token;
  }

  private purgeExpiredCodes(): void {
    this.db.prepare('DELETE FROM transfer_codes WHERE expires_at < ?').run(Date.now());
  }

  close(): void {
    this.db.close();
  }
}
