import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { TaskStageEntry } from '../shared/scripted.js';
import type { HeldMessage, HubTask } from '../shared/types.js';
import { addressedConversationId } from '../domain/conversation-role.js';
import { heldMessagesFor } from '../domain/held-message.js';
import { composeHeldMessageDelivery } from './held-message-delivery.js';
import type { LocatedTask } from './hub-repository.js';
import { STAGE_INSTRUCTION_SOURCE_KIND } from './stage-message.js';
import { createTaskMessage, TASK_MESSAGE_SOURCE_KIND } from './task-message.js';

/**
 * One exact stage-instruction attempt for one conversation. The map is an optimization:
 * the authoritative proof that an instruction still owns a batch is the native inbox, the
 * native log, and the exact instruction identity, all of which can rebuild this record.
 */
interface Attempt {
  taskId: string;
  entryId: string;
  columnId: string;
  /** The exact stage-instruction request identity this attempt belongs to, once known. */
  instructionId?: string;
  /** Identities prepared for this instruction's first step. */
  readonly inject: Set<string>;
  /** Identities injected into a proposed step whose durable acceptance is not recorded yet. */
  readonly awaiting: Set<string>;
  /** Identities recorded by the log, waiting for the durability checkpoint and the release. */
  readonly recorded: Set<string>;
  /** The turn that claimed the exact instruction; only its end may clear an unaccepted attempt. */
  claimedTurn?: number;
  /** The admission enqueued this attempt's instruction, or a rebuild found it queued. */
  armed: boolean;
  /** The durable log records this entry's instruction. */
  accepted: boolean;
  /** A retry that must let the admission finish its separate release before the entry retires. */
  recovering?: boolean;
  settling?: boolean;
  settleAgain?: boolean;
  retiring?: boolean;
  /** Detach the abort listener this attempt installed, when it installed one. */
  dispose?: () => void;
}

export interface HeldMessageBatchPorts {
  /** The task that owns a conversation; absent means an ordinary chat that receives nothing. */
  locateBySession(sessionId: string): LocatedTask | undefined;
  /** The conversation's durable events. */
  events(sessionId: string): Promise<readonly unknown[]>;
  /** The conversation's pending native input, including a restored inbox. */
  pending(agent: Agent): readonly unknown[];
  /** Remove held messages and record their released identities in one local write. */
  release(taskId: string, ids: readonly string[]): Promise<void>;
  /** Deliver the messages this conversation does not own through the separate path. */
  releaseOthers(taskId: string, columnId: string, deliveredSessionId: string): Promise<void>;
  /** Retire the unresolved entry once its instruction and every handoff it carried are recorded. */
  retireEntry(taskId: string, entryId: string): Promise<void>;
  /**
   * Prove the conversation's appended records reached durable storage. It resolves true
   * only when a durability mechanism participated and settled; an absent mechanism is not
   * proof, so the caller keeps the message held.
   */
  checkpoint(sessionId: string): Promise<boolean>;
  report?(error: unknown): void;
}

/** The batch admission one registration exposes to the stage-instruction admission. */
export interface HeldMessageBatch {
  /**
   * Prepare the conversation for the instruction this admission is about to send. It fails
   * when the handoffs cannot be prepared, before any wake, so a failed preparation never
   * consumes input and never runs the stage without its handoffs. `accepted` means the
   * conversation already durably records this entry's instruction, so the admission must
   * not send it again; the remaining handoffs then use the separate path.
   */
  prepare(taskId: string, columnId: string, sessionId: string, instructionId: string): Promise<'deliver' | 'accepted'>;
  /** Forget an attempt whose native delivery failed, so the same entry can be retried. */
  abandon(taskId: string, columnId: string, sessionId: string): void;
  dispose(): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The producer marker of one native or durable message, when it carries one. */
function sourceOf(value: unknown): Record<string, unknown> | undefined {
  if (!record(value)) return undefined;
  return record(value.source) ? value.source : undefined;
}

/** Whether this message is the instruction of exactly one stage entry. */
function instructionFor(value: unknown, entry: TaskStageEntry): boolean {
  const source = sourceOf(value);
  return source?.kind === STAGE_INSTRUCTION_SOURCE_KIND
    && typeof source.requestId === 'string' && source.requestId !== ''
    && source.entryId === entry.id
    && source.columnId === entry.columnId;
}

/** The request identity one stage-instruction message carries. */
function instructionIdentityOf(value: unknown): string | undefined {
  const source = sourceOf(value);
  return source?.kind === STAGE_INSTRUCTION_SOURCE_KIND && typeof source.requestId === 'string' && source.requestId !== ''
    ? source.requestId
    : undefined;
}

/** Whether this durable event records the instruction of one stage entry. */
function instructionRecorded(event: unknown, entry: TaskStageEntry): boolean {
  if (!record(event) || event.type !== 'user/message') return false;
  const source = sourceOf(event.data);
  return source?.kind === STAGE_INSTRUCTION_SOURCE_KIND && source.entryId === entry.id && source.columnId === entry.columnId;
}

/** The task-message delivery identity a native message carries, if it is one. */
function heldIdentityOf(value: unknown): string | undefined {
  const source = sourceOf(value);
  return source?.kind === TASK_MESSAGE_SOURCE_KIND && typeof source.requestId === 'string' ? source.requestId : undefined;
}

/**
 * Whether the durable conversation log records one held-message identity. Only a recorded
 * user message counts: a spliced inbox insertion can be canceled before any step appends
 * it, so it is pending state for deduplication, never acceptance.
 */
function recordedInLog(events: readonly unknown[], id: string): boolean {
  return events.some(event => record(event) && event.type === 'user/message' && heldIdentityOf(event.data) === id);
}

/** The task-message identities a set of native messages already carries. */
function heldIdentitiesOf(messages: readonly unknown[]): Set<string> {
  const identities = new Set<string>();
  for (const message of messages) {
    const id = heldIdentityOf(message);
    if (id !== undefined) identities.add(id);
  }
  return identities;
}

/**
 * Context a host or plugin projects on its own schedule. It never warrants a model step
 * by itself, so withholding an instruction must not leave a step that carries only this.
 */
const GENERATED_CONTEXT_KINDS: ReadonlySet<string> = new Set([
  'runtime-context',
  'kanban-task',
  'stage-notice',
  'skill-catalog',
  'time-context',
]);

/** Whether a message carries work an author admitted, as opposed to generated context. */
function warrantsStep(value: unknown): boolean {
  const source = sourceOf(value);
  if (!record(source)) return true;
  return typeof source.kind !== 'string' || !GENERATED_CONTEXT_KINDS.has(source.kind);
}

/** The messages one stage holds for one conversation, in queue order. */
function eligible(task: HubTask, columnId: string, sessionId: string): HeldMessage[] {
  return heldMessagesFor(task, columnId).filter(message => addressedConversationId(task, message.agent) === sessionId);
}

/** The one queued stage instruction of one entry in a restored inbox. */
function queuedInstruction(messages: readonly unknown[], entry: TaskStageEntry): { message: UserMessage; instructionId: string } | undefined {
  for (const message of messages) {
    if (!instructionFor(message, entry)) continue;
    const instructionId = instructionIdentityOf(message);
    if (instructionId === undefined) continue;
    return { message: message as UserMessage, instructionId };
  }
  return undefined;
}

/** What preparation found for one exact attempt. */
interface Classification {
  readonly taskId: string;
  readonly entryId: string;
  readonly columnId: string;
  /** Identities the log already records; they finalize and never inject again. */
  readonly recorded: string[];
  /** Identities this instruction's first step may carry. */
  readonly inject: string[];
  /** Whether the log already records this entry's instruction. */
  readonly accepted: boolean;
}

type ClassificationResult = { kind: 'ready'; value: Classification } | { kind: 'skip' };

/**
 * Deliver the messages held for the stage entry whose instruction a step executes into that
 * same step, immediately after the instruction and in hold-queue order. Each keeps its own
 * native source and delivery identity, so it stays a separately identified conversation
 * message instead of being folded into the instruction or waking a second step.
 *
 * Preparation (history read, durability checkpoint, classification) runs in the stage
 * admission before the instruction wakes its turn, and is rebuilt on native resume from the
 * restored inbox. The pre-step is the invariant: when a step carries the exact instruction
 * of an entry that still holds eligible handoffs, it reconciles at that boundary if the map
 * is missing, then re-reads authority and the queue before splicing. If neither preparation
 * nor reconciliation succeeds, only that instruction is removed from the step — unrelated
 * input still runs and the entry keeps its retry action — and an empty remainder is not sent.
 *
 * Acceptance is the recorded user message plus a successful durability checkpoint for every
 * identity the step was meant to carry; only then does the unresolved entry retire. A
 * rejected, canceled, or interrupted attempt leaves the entry actionable, and a retry whose
 * instruction is already recorded finalizes the recorded handoffs and releases the rest
 * through the separate path without sending the instruction twice.
 */
export function registerHeldMessageBatch(ctx: Context, ports: HeldMessageBatchPorts): HeldMessageBatch {
  const report = ports.report ?? ((error: unknown) => {
    try { ctx.logger?.warn?.(`Kanban held-message batch failed: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* logging is best effort */ }
  });
  const attempts = new Map<string, Attempt>();

  const track = (sessionId: string, taskId: string, entryId: string, columnId: string): Attempt => {
    const existing = attempts.get(sessionId);
    if (existing !== undefined) {
      if (existing.entryId === entryId) return existing;
      // An older entry's leftovers settle under their own entry identity; a new entry never
      // inherits them.
      existing.inject.clear();
      existing.armed = false;
      existing.recovering = undefined;
      existing.claimedTurn = undefined;
      if (existing.recorded.size > 0) settle(sessionId, existing);
      else forget(sessionId, existing);
      if (attempts.get(sessionId) === existing) attempts.delete(sessionId);
    }
    const created: Attempt = { taskId, entryId, columnId, inject: new Set(), awaiting: new Set(), recorded: new Set(), armed: false, accepted: false };
    attempts.set(sessionId, created);
    return created;
  };
  const forget = (sessionId: string, attempt: Attempt): void => {
    if (attempt.inject.size > 0 || attempt.awaiting.size > 0 || attempt.recorded.size > 0 || attempt.settling === true || attempt.retiring === true) return;
    attempt.dispose?.();
    if (attempts.get(sessionId) === attempt) attempts.delete(sessionId);
  };
  /** Retire the entry once the instruction and every handoff it carried are durably recorded. */
  const retire = (sessionId: string, attempt: Attempt): void => {
    if (!attempt.accepted || attempt.retiring === true || attempt.recovering === true) return;
    if (attempt.inject.size > 0 || attempt.awaiting.size > 0 || attempt.recorded.size > 0) return;
    attempt.retiring = true;
    void ports.retireEntry(attempt.taskId, attempt.entryId).catch(report).finally(() => {
      attempt.retiring = false;
      forget(sessionId, attempt);
    });
  };
  /**
   * Checkpoint the conversation and release the identities recorded since preparation. A
   * failed checkpoint keeps them held; the loop coalesces identities published while one
   * pass is in flight, so a later append is never stranded behind an earlier release.
   */
  const settle = (sessionId: string, attempt: Attempt, confirmed = false): void => {
    if (attempt.settling === true) { attempt.settleAgain = true; return; }
    if (attempt.recorded.size === 0) { retire(sessionId, attempt); return; }
    attempt.settling = true;
    void (async () => {
      let skipCheckpoint = confirmed;
      try {
        // Let the rest of the publishing event's synchronous listeners run first, so the
        // backend has buffered the append this checkpoint must cover.
        await Promise.resolve();
        while (attempt.settleAgain || attempt.recorded.size > 0) {
          attempt.settleAgain = false;
          const ids = [...attempt.recorded];
          if (ids.length === 0) break;
          if (!skipCheckpoint && !(await ports.checkpoint(sessionId))) {
            throw new Error('The conversation cannot confirm durable storage, so its recorded message stays queued.');
          }
          skipCheckpoint = false;
          await ports.release(attempt.taskId, ids);
          for (const id of ids) attempt.recorded.delete(id);
        }
        retire(sessionId, attempt);
      } catch (error) {
        report(error);
      } finally {
        attempt.settling = false;
        forget(sessionId, attempt);
      }
    })();
  };

  /**
   * Classify the live queue for one exact entry: what the log already records, what the
   * first step may carry, and whether the instruction itself is already recorded. It
   * checkpoints before trusting a recorded match, and re-reads authority afterwards.
   */
  async function classify(sessionId: string, taskId: string, columnId: string): Promise<ClassificationResult> {
    const located = ports.locateBySession(sessionId);
    const entry = located?.task.stageEntry;
    if (located === undefined || located.task.id !== taskId || entry === undefined || entry.columnId !== columnId) return { kind: 'skip' };
    if (eligible(located.task, columnId, sessionId).length === 0) return { kind: 'skip' };
    const events = await ports.events(sessionId);
    const matched = eligible(located.task, columnId, sessionId).filter(message => recordedInLog(events, message.id));
    const accepted = events.some(event => instructionRecorded(event, entry));
    // A live append is not proof. Only a successful checkpoint makes a matching record
    // durable, so preparation fails (before any wake) when it cannot be proven.
    if ((matched.length > 0 || accepted) && !await ports.checkpoint(sessionId)) {
      throw new Error('The conversation cannot confirm durable storage, so the ' + columnId + ' stage instruction was not sent.');
    }
    const live = ports.locateBySession(sessionId);
    if (live === undefined || live.task.stageEntry?.id !== entry.id || live.task.columnId !== columnId) return { kind: 'skip' };
    const queue = eligible(live.task, columnId, sessionId);
    return {
      kind: 'ready',
      value: {
        taskId: live.task.id,
        entryId: entry.id,
        columnId,
        recorded: queue.filter(message => recordedInLog(events, message.id)).map(message => message.id),
        inject: queue.filter(message => !recordedInLog(events, message.id)).map(message => message.id),
        accepted,
      },
    };
  }

  /** Apply one classification to the live attempt record. */
  function apply(sessionId: string, value: Classification, options: { instructionId?: string; armed: boolean; claimedTurn?: number }): Attempt {
    const attempt = track(sessionId, value.taskId, value.entryId, value.columnId);
    attempt.inject.clear();
    for (const id of value.inject) attempt.inject.add(id);
    attempt.awaiting.clear();
    if (options.instructionId !== undefined) attempt.instructionId = options.instructionId;
    attempt.armed = options.armed && !value.accepted;
    attempt.claimedTurn = options.claimedTurn;
    attempt.accepted = value.accepted;
    attempt.recovering = value.accepted;
    if (value.recorded.length > 0) {
      for (const id of value.recorded) attempt.recorded.add(id);
      settle(sessionId, attempt, true);
    }
    return attempt;
  }

  const prepare: HeldMessageBatch['prepare'] = async (taskId, columnId, sessionId, instructionId) => {
    const running = attempts.get(sessionId);
    const locatedEntry = ports.locateBySession(sessionId)?.task.stageEntry;
    if (running !== undefined && running.entryId === locatedEntry?.id && running.armed
      && (running.instructionId === undefined || running.instructionId === instructionId)) {
      throw new Error('The ' + columnId + ' stage instruction of task ' + taskId
        + ' is already being delivered to its conversation. Wait for that attempt to settle before retrying.');
    }
    const value = await classify(sessionId, taskId, columnId);
    if (value.kind === 'skip') {
      const idle = attempts.get(sessionId);
      if (idle !== undefined && idle.columnId === columnId) { idle.inject.clear(); idle.armed = false; idle.claimedTurn = undefined; forget(sessionId, idle); }
      return 'deliver';
    }
    const attempt = apply(sessionId, value.value, { instructionId, armed: true });
    if (value.value.accepted) { attempt.inject.clear(); return 'accepted'; }
    return 'deliver';
  };

  /**
   * Rebuild the preparation for an instruction the host restored into a live inbox. It
   * never wakes the conversation: it only reads the task, the queued instruction and the
   * native log, so the awaited agent/created hook can hold the restored work until it ends.
   */
  async function rebuild(sessionId: string, agent: Agent): Promise<void> {
    const located = ports.locateBySession(sessionId);
    const entry = located?.task.stageEntry;
    if (located === undefined || entry === undefined) return;
    const queued = queuedInstruction(ports.pending(agent), entry);
    if (queued === undefined) return;
    if (eligible(located.task, entry.columnId, sessionId).length === 0) return;
    const value = await classify(sessionId, located.task.id, entry.columnId);
    if (value.kind === 'skip' || value.value.accepted) return;
    apply(sessionId, value.value, { instructionId: queued.instructionId, armed: false });
  }

  const offCreated = ctx.on('agent/created', async ({ agent }) => {
    try { await rebuild(String(agent.id), agent); } catch (error) { report(error); }
  });

  const offClaimed = ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const sessionId = String(agent.id);
    const attempt = attempts.get(sessionId);
    if (attempt === undefined) return;
    const source = sourceOf(message);
    if (source?.kind !== STAGE_INSTRUCTION_SOURCE_KIND || source.entryId !== attempt.entryId) return;
    if (attempt.instructionId !== undefined && source.requestId !== attempt.instructionId) return;
    attempt.instructionId ??= typeof source.requestId === 'string' ? source.requestId : undefined;
    attempt.claimedTurn = turn;
  });

  // A queued instruction the host discarded before any step never wakes; the exact attempt
  // is no longer in flight, so the entry's existing action can admit it again.
  const offDiscarded = ctx.on('agent/inbox/discarded', ({ agent, message }) => {
    const sessionId = String(agent.id);
    const attempt = attempts.get(sessionId);
    if (attempt === undefined) return;
    const source = sourceOf(message);
    if (source?.kind !== STAGE_INSTRUCTION_SOURCE_KIND || source.entryId !== attempt.entryId) return;
    if (attempt.instructionId !== undefined && source.requestId !== attempt.instructionId) return;
    attempt.armed = false;
    attempt.claimedTurn = undefined;
    attempt.inject.clear();
    forget(sessionId, attempt);
  });

  const offStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || payload.signal.aborted) return decision;
    const sessionId = String(payload.agent.id);
    const located = ports.locateBySession(sessionId);
    const entry = located?.task.stageEntry;
    if (located === undefined || entry === undefined) return decision;
    const at = decision.messages.findIndex(message => instructionFor(message, entry));
    if (at < 0) return decision;
    const instruction = decision.messages[at]!;
    const instructionId = instructionIdentityOf(instruction);
    try {
      // The invariant: the instruction of an entry that still holds eligible handoffs cannot
      // run without them, even when the prepared map is empty after a resume or reload.
      const eligibleNow = eligible(located.task, entry.columnId, sessionId);
      const existing = attempts.get(sessionId);
      // Work already present in the step or in the native inbox never needs a second copy.
      const known = heldIdentitiesOf([...decision.messages, ...ports.pending(payload.agent)]);
      // A plan is usable only when it accounts for every eligible handoff the live entry
      // holds now, not just the ones it saw when it was prepared.
      const covers = existing !== undefined && existing.entryId === entry.id && existing.inject.size > 0
        && (instructionId === undefined || existing.instructionId === undefined || existing.instructionId === instructionId)
        && eligibleNow.every(message => known.has(message.id) || existing.inject.has(message.id)
          || existing.awaiting.has(message.id) || existing.recorded.has(message.id));
      let attempt: Attempt;
      if (covers) {
        attempt = existing;
      } else {
        // Nothing eligible remains for this conversation, so there is nothing to enforce;
        // a prepared message whose recipient rebound still goes to the separate path.
        if (eligibleNow.length === 0) {
          if (existing !== undefined && existing.entryId === entry.id) {
            const prepared = heldMessagesFor(located.task, entry.columnId).some(message => existing.inject.has(message.id));
            existing.inject.clear();
            if (prepared) void ports.releaseOthers(located.task.id, entry.columnId, sessionId).catch(report);
            forget(sessionId, existing);
          }
          return decision;
        }
        // Targeted reconciliation at the exact instruction boundary.
        const value = await classify(sessionId, located.task.id, entry.columnId);
        if (value.kind === 'skip') {
          // The authority moved while reconciling; that instruction is no longer this entry's.
          return decision;
        }
        attempt = apply(sessionId, value.value, { instructionId, armed: false, claimedTurn: payload.turn });
      }
      const live = ports.locateBySession(sessionId);
      const liveEntry = live?.task.stageEntry;
      if (live === undefined || liveEntry === undefined || liveEntry.id !== entry.id || liveEntry.columnId !== entry.columnId) {
        attempt.inject.clear();
        forget(sessionId, attempt);
        return decision;
      }
      const queue = heldMessagesFor(live.task, entry.columnId);
      const selected: HeldMessage[] = [];
      for (const message of queue) {
        if (!attempt.inject.has(message.id)) continue;
        if (known.has(message.id) || attempt.awaiting.has(message.id) || attempt.recorded.has(message.id)) continue;
        if (addressedConversationId(live.task, message.agent) !== sessionId) continue;
        selected.push(message);
      }
      // A prepared message whose recipient changed meanwhile belongs to the separate path.
      const foreign = queue.filter(message => attempt.inject.has(message.id) && addressedConversationId(live.task, message.agent) !== sessionId);
      attempt.inject.clear();
      if (foreign.length > 0) void ports.releaseOthers(live.task.id, entry.columnId, sessionId).catch(report);
      if (selected.length === 0) { forget(sessionId, attempt); return decision; }
      for (const message of selected) attempt.awaiting.add(message.id);
      const batch: UserMessage[] = selected.map(message => createTaskMessage(composeHeldMessageDelivery(live.task, live.board.workflow, message)));
      // A step aborted before the log records the batch leaves it held for an eligible retry.
      const onAbort = () => {
        for (const message of selected) attempt.awaiting.delete(message.id);
        forget(sessionId, attempt);
      };
      attempt.dispose = () => payload.signal.removeEventListener('abort', onAbort);
      payload.signal.addEventListener('abort', onAbort, { once: true });
      return {
        ...decision,
        messages: [...decision.messages.slice(0, at + 1), ...batch, ...decision.messages.slice(at + 1)],
      };
    } catch (error) {
      // Neither preparation nor reconciliation succeeded: suppress only this instruction.
      // Unrelated input still runs; when nothing else remains, no request is sent at all.
      report(new Error('Kanban withheld the ' + entry.columnId + ' stage instruction of task ' + located.task.id
        + ' because its held messages could not be prepared at its first step: '
        + (error instanceof Error ? error.message : String(error)), { cause: error }));
      // Withhold only this instruction. A step whose remaining messages are generated
      // context alone must not start a model request; independently admitted work does.
      const remaining = decision.messages.filter((_message, index) => index !== at);
      return remaining.some(warrantsStep) ? { ...decision, messages: remaining } : { kind: 'reject' };
    }
  }, { prepend: true });

  const offEvent = ctx.on('session/event', (session, event) => {
    if (!record(event)) return;
    const sessionId = String(session.id);
    const attempt = attempts.get(sessionId);
    if (attempt === undefined) return;
    if (event.type === 'turn/end') {
      // Durable receipts settle independently of which turn ended.
      if (attempt.recorded.size > 0) settle(sessionId, attempt);
      // Only the turn that claimed this exact instruction may retire an unaccepted attempt;
      // an earlier or unrelated turn ending must leave a still-queued preparation intact.
      const turn = record(event.data) && typeof event.data.turn === 'number' ? event.data.turn : undefined;
      if (turn === undefined || attempt.claimedTurn !== turn) return;
      const incomplete = attempt.awaiting.size > 0;
      attempt.awaiting.clear();
      attempt.inject.clear();
      attempt.armed = false;
      attempt.claimedTurn = undefined;
      if (attempt.recorded.size > 0) settle(sessionId, attempt);
      else if (attempt.accepted && !incomplete) retire(sessionId, attempt);
      else forget(sessionId, attempt);
      return;
    }
    if (event.type !== 'user/message') return;
    const source = sourceOf(event.data);
    if (source?.kind === STAGE_INSTRUCTION_SOURCE_KIND && source.entryId === attempt.entryId
      && (attempt.instructionId === undefined || source.requestId === attempt.instructionId)) attempt.accepted = true;
    const id = heldIdentityOf(event.data);
    if (id !== undefined && attempt.awaiting.has(id)) {
      attempt.awaiting.delete(id);
      attempt.recorded.add(id);
      settle(sessionId, attempt);
      return;
    }
    if (attempt.accepted) retire(sessionId, attempt);
  });

  return {
    prepare,
    abandon(taskId: string, columnId: string, sessionId: string): void {
      const attempt = attempts.get(sessionId);
      if (attempt === undefined || attempt.taskId !== taskId || attempt.columnId !== columnId || attempt.accepted) return;
      attempt.armed = false;
      attempt.inject.clear();
      attempt.claimedTurn = undefined;
      if (attempt.recorded.size > 0) settle(sessionId, attempt);
      else forget(sessionId, attempt);
    },
    dispose() { offStep(); offEvent(); offCreated(); offClaimed(); offDiscarded(); attempts.clear(); },
  };
}
