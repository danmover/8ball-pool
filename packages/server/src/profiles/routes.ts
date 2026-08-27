import type { Express, Request } from 'express';
import express from 'express';
import { MAX_PROFILE_BYTES, type ProfileRepository } from './repository.js';

/**
 * The profile API.
 *
 * No email, no password, no reset flow. The server issues an opaque token on first play, the
 * browser keeps it, and a short **transfer code** moves the profile to a second device. That is
 * the right weight of identity for a party game: it gets progress off one browser without
 * putting an auth surface and a pile of personal data into something people play at a barbecue.
 *
 * The obvious cost, stated rather than hidden: lose every device and the profile is gone, since
 * there is nothing to prove it was ever yours.
 */

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

export function registerProfileRoutes(app: Express, repo: ProfileRepository): void {
  app.use('/api', express.json({ limit: MAX_PROFILE_BYTES }));

  /** First play on a device with no token: mint one. */
  app.post('/api/profile', (req, res) => {
    const { token, stored } = repo.create(req.body?.profile ?? {});
    res.json({ token, profile: stored.data, revision: stored.revision });
  });

  app.get('/api/profile', (req, res) => {
    const token = bearer(req);
    const stored = token ? repo.get(token) : null;
    if (!stored) {
      res.status(404).json({ error: 'no such profile' });
      return;
    }
    res.json({ profile: stored.data, revision: stored.revision, updatedAt: stored.updatedAt });
  });

  app.put('/api/profile', (req, res) => {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ error: 'missing token' });
      return;
    }
    const revision = Number(req.body?.revision);
    if (!Number.isFinite(revision)) {
      res.status(400).json({ error: 'missing revision' });
      return;
    }

    const stored = repo.save(token, req.body?.profile, revision);
    if (!stored) {
      // Either the token is unknown or the write is stale. Hand back what's actually stored so
      // the client can reconcile instead of guessing.
      const current = repo.get(token);
      if (!current) {
        res.status(404).json({ error: 'no such profile' });
        return;
      }
      res.status(409).json({
        error: 'stale revision',
        profile: current.data,
        revision: current.revision,
      });
      return;
    }
    res.json({ revision: stored.revision, updatedAt: stored.updatedAt });
  });

  /** "Show me a code I can type into my phone." */
  app.post('/api/profile/transfer', (req, res) => {
    const token = bearer(req);
    const issued = token ? repo.createTransferCode(token) : null;
    if (!issued) {
      res.status(404).json({ error: 'no such profile' });
      return;
    }
    res.json(issued);
  });

  /** "Here's the code from my other device." */
  app.post('/api/profile/claim', (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    const token = code ? repo.redeemTransferCode(code) : null;
    const stored = token ? repo.get(token) : null;
    if (!token || !stored) {
      res.status(404).json({ error: 'unknown or expired code' });
      return;
    }
    res.json({ token, profile: stored.data, revision: stored.revision });
  });
}
