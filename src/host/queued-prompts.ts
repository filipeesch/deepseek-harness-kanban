import { KanbanError } from '../shared/errors.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The durable prompt identity a queued message carries, when it has one. */
function promptIdentity(item: unknown): string | undefined {
  if (!record(item) || !record(item.source)) return undefined;
  const value = item.source.rpcId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Whether one queued item is human input. The `next-step` inbox also carries
 * host-injected context notices (for example a working-directory change), which
 * park there while idle and are not input the user owes the task. An item whose
 * shape or source is unrecognized still counts, so an unknown producer fails
 * closed instead of disappearing from the wait state.
 */
function isUserInput(item: unknown): boolean {
  if (!record(item) || !record(item.source)) return true;
  return item.source.kind === 'user';
}

/** Bound on remembered identities per conversation; older entries are evicted first. */
const MAX_TRACKED_PROMPTS = 64;

/**
 * Prompt identities this host admitted itself, per conversation. A queued stage
 * instruction is the host's own work, not input the user still owes the task, so
 * the pending-user-work read skips it. The ledger is bounded rather than pruned by
 * the queue's current contents: a prompt is recorded before its queue insertion is
 * observable, so pruning on absence could forget an instruction that is about to
 * appear and read it back as user work.
 */
export class PluginPromptLedger {
  private readonly bySession = new Map<string, string[]>();

  add(sessionId: string, requestId: string): void {
    const ids = this.bySession.get(sessionId) ?? [];
    if (ids.includes(requestId)) return;
    ids.push(requestId);
    if (ids.length > MAX_TRACKED_PROMPTS) ids.splice(0, ids.length - MAX_TRACKED_PROMPTS);
    this.bySession.set(sessionId, ids);
  }

  has(sessionId: string, requestId: string): boolean {
    return this.bySession.get(sessionId)?.includes(requestId) === true;
  }
}

export interface QueuedPromptDeps {
  /** The live agent inbox, absent when the conversation is not attached. */
  live(sessionId: string): { nextTurn: readonly unknown[]; nextStep: readonly unknown[] } | undefined;
}

function countItems(sessionId: string, items: readonly unknown[], own: PluginPromptLedger): number {
  let count = 0;
  for (const item of items) {
    if (!isUserInput(item)) continue;
    const identity = promptIdentity(item);
    if (identity !== undefined && own.has(sessionId, identity)) continue;
    count += 1;
  }
  return count;
}

function inboxLists(inbox: unknown): readonly unknown[] {
  if (inbox === undefined) return [];
  if (!record(inbox)) throw new KanbanError('SESSION_STATE_UNAVAILABLE', 'The native conversation inbox state is unavailable.');
  const lists: unknown[] = [];
  for (const key of ['next-turn', 'next-step'] as const) {
    const value = inbox[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new KanbanError('SESSION_STATE_UNAVAILABLE', 'The native conversation inbox state is unavailable.');
    lists.push(...value);
  }
  return lists;
}

/**
 * Count the user messages queued for a later turn in one conversation. A live
 * conversation reads its agent inbox synchronously; otherwise the durable inbox
 * projection the caller already read is the source, so one facts read never
 * fetches it twice. Only human input counts: the `next-step` list also parks
 * host-injected context notices that are not user work. An unreadable state
 * throws so callers fail closed instead of reporting an idle conversation.
 */
export function createQueuedPromptReader(deps: QueuedPromptDeps, own: PluginPromptLedger): (sessionId: string, projection: unknown) => number {
  return (sessionId: string, projection: unknown): number => {
    const live = deps.live(sessionId);
    if (live !== undefined) return countItems(sessionId, [...live.nextTurn, ...live.nextStep], own);
    if (!record(projection) || projection.kind !== 'sequenced' || !record(projection.values)) {
      throw new KanbanError('SESSION_STATE_UNAVAILABLE', 'Exact native inbox state is unavailable for this conversation.');
    }
    return countItems(sessionId, inboxLists(projection.values.inbox), own);
  };
}
