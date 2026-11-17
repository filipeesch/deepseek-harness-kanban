import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { SessionArtifactLocation } from '../shared/types.js';
import { SessionRepair, SessionRepairRefused, type SessionRepairPorts } from './session-repair.js';
import { createInstalledSessionValidator, type SessionArtifactValidator } from './session-validator.js';

export interface HostSessionRepairOptions {
  /** Whether the running host already has this Session live. */
  live(sessionId: string): boolean;
  /** The artifact path and revision, from storage metadata only. */
  location(sessionId: string): Promise<SessionArtifactLocation | undefined>;
  /** Re-observe the conversation so the running host agrees with the repaired artifact. */
  observe(sessionId: string): Promise<void>;
  now?: () => Date;
  /** The loader-chain validator; the installed chain by default. */
  validate?: SessionArtifactValidator;
  /** Writes a staged candidate; injected so a test can fail after partial bytes exist. */
  writeCandidate?: (path: string, bytes: Buffer) => Promise<void>;
}

/**
 * Resolve the sessions root from one artifact path. The JSONL layout is
 * \`<root>/<project-directory>/<session-directory>/<artifact>\`, so the third parent
 * is the root and its name proves the layout before anything is written beside it.
 */
export function sessionsRootOf(artifactPath: string): string | undefined {
  const root = dirname(dirname(dirname(artifactPath)));
  return basename(root) === 'sessions' ? root : undefined;
}

/**
 * Compose the repair pipeline over the host's file system and metadata read.
 * The backup lives beside the sessions tree, never inside it, so the backend
 * never lists a repaired copy as a generation; the staging file stays beside the
 * artifact so the final move is an atomic rename on one filesystem.
 */
export function createHostSessionRepair(options: HostSessionRepairOptions): SessionRepair {
  const now = options.now ?? (() => new Date());
  const validate = options.validate ?? createInstalledSessionValidator();
  const writeCandidate = options.writeCandidate ?? ((path: string, bytes: Buffer) => writeFile(path, bytes));
  const ports: SessionRepairPorts = {
    live: sessionId => options.live(sessionId),
    location: sessionId => options.location(sessionId),
    readArtifact: path => readFile(path),
    async stageArtifact(path, bytes) {
      const staging = join(dirname(path), '.' + basename(path) + '.kanban-repair-' + randomUUID());
      try { await writeCandidate(staging, bytes); }
      catch (error) {
        // A failed write must not leave a partial candidate behind: the caller never
        // learns this path, so it could not discard it.
        await rm(staging, { force: true }).catch(() => undefined);
        throw error;
      }
      return staging;
    },
    replaceArtifact: (staging, path) => rename(staging, path),
    discardArtifact: staging => rm(staging, { force: true }),
    async keepBackup(sessionId, location, bytes, at) {
      const root = sessionsRootOf(location.path);
      if (root === undefined) throw new SessionRepairRefused('The stored log is not inside a recognizable sessions directory, so no backup can be kept and nothing was repaired.');
      const stamp = at.toISOString().replace(/[:.]/g, '-');
      const directory = resolve(root, '..', 'session-repair-backups', 'kanban', sessionId, stamp);
      await mkdir(directory, { recursive: true });
      const target = join(directory, basename(location.path));
      await writeFile(target, bytes);
      return target;
    },
    observe: sessionId => options.observe(sessionId),
    validate,
    now,
  };
  return new SessionRepair(ports);
}
