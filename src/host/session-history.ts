import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-session-persistence';
import { SessionId, type SessionEvent, type SessionHeader, type SessionLogOffset } from '@deepseek-ai/dsh-session';
import type { SessionArtifactLocation } from '../shared/types.js';

const READ_TIMEOUT_MS = 30_000;

/** One immutable session-log read owned by the host adapter. */
export interface SessionHistory {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  readonly inheritedEventCount: SessionLogOffset;
}

export interface SessionHistoryReadOptions {
  readonly signal?: AbortSignal;
  /** Projection computation for the observation; history reads normally need none. */
  readonly projections?: 'all' | 'none';
}

/** Reads one exact Session log without exposing the observation lease. */
export interface SessionHistoryReader {
  read(sessionId: string, options?: SessionHistoryReadOptions): Promise<SessionHistory>;
  /**
   * Resolve one conversation's durable artifact path and revision from storage
   * metadata. It never reads the log body and never opens the artifact for write,
   * so it is safe for a conversation whose contents cannot be validated.
   */
  locate(sessionId: string): Promise<SessionArtifactLocation | undefined>;
}

/** Narrow history read for consumers that only need the event log. */
export interface SessionEventsReader {
  read(sessionId: string, options?: SessionHistoryReadOptions): Promise<{ readonly events: readonly unknown[] }>;
}

/**
 * Build the only host adapter allowed to read Session history.
 * The observation lease is always released; consumers receive immutable values.
 */
export function createSessionHistory(ctx: Context): SessionHistoryReader {
  return {
    async read(sessionId, options = {}) {
      const signal = options.signal ?? AbortSignal.timeout(READ_TIMEOUT_MS);
      const observation = await ctx.sessionQuery.observeSession(SessionId(sessionId), {
        signal,
        projectionMode: options.projections ?? 'none',
      });
      try {
        return {
          header: observation.header,
          events: observation.events,
          inheritedEventCount: observation.inheritedEventCount,
        };
      } finally {
        observation[Symbol.dispose]();
      }
    },
    async locate(sessionId) {
      const persistence = ctx.sessionPersistence;
      if (persistence === undefined) return undefined;
      try {
        const snapshot = await persistence.stat(SessionId(sessionId), { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
        const location = snapshot?.location;
        if (snapshot === undefined || location === undefined) return undefined;
        return { kind: location.kind, path: location.path, revision: String(snapshot.revision) };
      } catch {
        // An unavailable location is not a diagnosis: the caller presents the state without it.
        return undefined;
      }
    },
  };
}
