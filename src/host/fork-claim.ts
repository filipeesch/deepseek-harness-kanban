import { isTaskBusy, type ForkAdopter, type ForkAdoptionOutcome } from './conversation-adoption.js';
import { KanbanError } from '../shared/errors.js';

/** One explicit request to attach a branch to a task conversation. */
export interface ForkClaimInput {
  readonly taskId: string;
  /** The open conversation the branch was taken from. */
  readonly parentSessionId: string;
  /** The forked Session to attach. */
  readonly sessionId: string;
}

/** Attaches a claimed fork through the same adoption path the announcement uses. */
export interface ForkClaimPort {
  claim(input: ForkClaimInput): Promise<void>;
}

/** The log facts a branch-proof comparison reads from one Session. */
export interface ForkClaimLog {
  /** How many events the Session inherited from its source, when it is a branch. */
  readonly inheritedEventCount?: number;
  readonly events: readonly unknown[];
}

/**
 * Compose the log-prefix proof for hosts that record no fork lineage.
 *
 * `buildForkSeed` copies the source events through the cut into the branch, so a
 * matching head proves which conversation the branch came from without any
 * lineage field. The comparison samples the start of the inherited prefix, which
 * is enough to identify the source while keeping both log reads bounded.
 */
export function createInheritedPrefixCheck(read: (sessionId: string) => Promise<ForkClaimLog>): (sessionId: string, parentSessionId: string) => Promise<boolean> {
  return async (sessionId, parentSessionId) => {
    if (sessionId === parentSessionId) return false;
    // A Session that inherits nothing is a new conversation: refuse before reading
    // the claimed conversation, so an ordinary chat costs one log read.
    const child = await read(sessionId);
    const inherited = child.inheritedEventCount;
    if (inherited === undefined || inherited <= 0) return false;
    const parent = await read(parentSessionId);
    if (inherited > parent.events.length) return false;
    const head = Math.min(inherited, 2);
    for (let index = 0; index < head; index += 1) {
      if (JSON.stringify(child.events[index]) !== JSON.stringify(parent.events[index])) return false;
    }
    // The last inherited event is the discriminating one: it marks the cut.
    return JSON.stringify(child.events[inherited - 1]) === JSON.stringify(parent.events[inherited - 1]);
  };
}

/** The lineage facts of one existing Session, as its header records them. */
export interface ForkClaimLineage {
  readonly parentSessionId?: string;
  readonly origin?: 'subagent';
}

export interface ForkClaimPorts {
  /** The adoption coordinator; the claim reuses its alignment and retry behavior. */
  readonly adopter: Pick<ForkAdopter, 'claim'>;
  /** Read the Session's recorded lineage without opening its conversation. */
  readonly lineage: (sessionId: string) => Promise<ForkClaimLineage>;
  /**
   * Whether a Session inherits the start of another conversation's log.
   *
   * A host that records no fork lineage on the child's header still copies the
   * source prefix into the child log, so the prefix identifies the branch source.
   */
  readonly inheritsPrefix?: (sessionId: string, parentSessionId: string) => Promise<boolean>;
  /** The task that already retains a Session, when any. */
  readonly taskOfSession: (sessionId: string) => string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Compose the host command that attaches a fork the drawer claimed.
 *
 * The claim is explicit, so a failure reason must reach the caller instead of
 * only being reported: the child's recorded lineage is checked against the
 * claimed parent, or, when the host records none, the inherited log prefix is
 * compared with that conversation. The adoption coordinator then does the
 * directory alignment and the bounded retry while the task is busy, and an
 * already-attached branch is a success rather than a second attachment.
 */
export function createForkClaim(ports: ForkClaimPorts): ForkClaimPort {
  return {
    async claim(input: ForkClaimInput): Promise<void> {
      if (input.sessionId === input.parentSessionId) {
        throw new KanbanError('INVALID_ATTACH', 'A conversation cannot be attached to itself.');
      }
      let lineage: ForkClaimLineage;
      try {
        lineage = await ports.lineage(input.sessionId);
      } catch {
        throw new KanbanError('SESSION_CONTEXT_UNAVAILABLE', 'The branch could not be read before it was attached.');
      }
      if (lineage.origin === 'subagent') {
        throw new KanbanError('FORK_LINEAGE_MISMATCH', 'Only a branch of a conversation of this task can be attached.');
      }
      if (lineage.parentSessionId !== undefined) {
        if (lineage.parentSessionId !== input.parentSessionId) {
          throw new KanbanError('FORK_LINEAGE_MISMATCH', 'Only a branch of a conversation of this task can be attached.');
        }
      } else if (ports.inheritsPrefix === undefined || !(await ports.inheritsPrefix(input.sessionId, input.parentSessionId))) {
        // A Session that inherits nothing is a new conversation, not a branch of this one.
        throw new KanbanError('FORK_LINEAGE_MISMATCH', 'Only a branch of a conversation of this task can be attached.');
      }
      let outcome: ForkAdoptionOutcome;
      try {
        outcome = await ports.adopter.claim({
          sessionId: input.sessionId,
          parentSessionId: input.parentSessionId,
          ...(lineage.origin === undefined ? {} : { origin: lineage.origin }),
        }, ports.signal);
      } catch (error) {
        // The adopter rethrows the transport failure; a busy task still reads as busy
        // rather than as the host's internal wording.
        if (isTaskBusy(error)) throw new KanbanError('TASK_BUSY', 'The task stayed busy while the branch was attached. Try again.');
        throw error;
      }
      if (outcome === 'adopted') return;
      // The announcement may have attached it while the claim was in flight.
      if (ports.taskOfSession(input.sessionId) === input.taskId) return;
      if (outcome === 'cancelled') throw new KanbanError('FORK_CLAIM_CANCELLED', 'The plugin shut down before the branch could be attached.');
      if (outcome === 'ignored') throw new KanbanError('FORK_NOT_ATTACHABLE', 'The branch is not an adoptable fork of this task.');
      throw new KanbanError('TASK_BUSY', 'The task stayed busy while the branch was attached. Try again.');
    },
  };
}
