import type { SessionPort } from '../shared/ports.js';

/**
 * One execution pass's conversation-idleness read. Every decision asks the host,
 * because any await can let a conversation start new work and no verdict may be
 * reused across a mutation; what the probe removes is the fan-out cost — one
 * parallel read for the whole participant set, with repeated ids read once. The
 * native ports keep enforcing idleness themselves before they commit anything.
 */
export class ConversationProbe {
  constructor(private readonly sessions: Pick<SessionPort, 'isIdle'>) {}

  /** Whether every listed conversation is idle right now. */
  async allIdle(sessionIds: readonly string[]): Promise<boolean> {
    const unique = [...new Set(sessionIds)];
    const verdicts = await Promise.all(unique.map(id => this.sessions.isIdle(id)));
    return verdicts.every(Boolean);
  }
}
