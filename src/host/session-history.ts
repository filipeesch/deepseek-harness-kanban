import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session-query';
import { SessionId, type SessionEvent, type SessionHeader, type SessionLogOffset } from '@deepseek-ai/dsh-session';

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
  };
}
