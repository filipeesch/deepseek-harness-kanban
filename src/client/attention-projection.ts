import type { Attention, BackgroundActivity, BackgroundKind, ConversationFacts, PendingUserWork } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { awaitingReply, mergePendingUserWork, pendingUserWork } from '../domain/pending-user-work.js';

const MAX_LABEL_LENGTH = 120;
const KIND_ORDER: Record<BackgroundKind, number> = { job: 0, schedule: 1 };

/** Order the background items by family and bound each label for presentation. */
export function normalizeBackground(items: readonly BackgroundActivity[]): BackgroundActivity[] {
  return items
    .map(item => ({ kind: item.kind, label: item.label.length > MAX_LABEL_LENGTH ? item.label.slice(0, MAX_LABEL_LENGTH - 1) + '…' : item.label }))
    .sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);
}

/** The native status facts the projection reads; the client status snapshot satisfies it. */
export interface NativePendingStatus { readonly pendingInteraction?: unknown }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The domain-owned pending interaction's kind, when it reports one. */
function interactionKind(value: unknown): string {
  if (!record(value) || typeof value.kind !== 'string') return '';
  return value.kind.toLowerCase();
}

/**
 * Fold the client status's pending interaction into the durable pending value. A
 * recognizable approval keeps its own kind; an unknown or question-like kind only
 * adds the generic native-question kind when the host does not already name an
 * awaiting kind, so the held label never contradicts the host's own reason.
 */
function withPendingInteraction(facts: PendingUserWork, status: NativePendingStatus | undefined): PendingUserWork {
  const value = status?.pendingInteraction;
  if (value === undefined) return facts;
  const kind = interactionKind(value);
  if (kind.includes('approval') || kind.includes('permission')) return mergePendingUserWork([facts, pendingUserWork(['approval'])]);
  if (awaitingReply(facts)) return facts;
  return mergePendingUserWork([facts, pendingUserWork(['native-question'])]);
}

/**
 * Project one conversation's durable facts with the client-owned read acknowledgment.
 * Blue and red wait until no owned agent is running, so a delegation that has not
 * finished is never presented as a completed turn. The native status's pending
 * interaction joins the pending kinds, so the orange dot and the auto-mode hold
 * cannot disagree.
 */
export function projectConversation(facts: ConversationFacts, status: NativePendingStatus | undefined, acknowledged: number | undefined): Attention {
  const settled = facts.settledTurn;
  const unread = !facts.running && settled !== null && (acknowledged === undefined || settled.seq > acknowledged);
  const failed = !facts.running && settled !== null && settled.outcome === 'error' && (acknowledged === undefined || settled.seq > acknowledged);
  const pending = withPendingInteraction(facts.pending, status);
  return {
    running: facts.running,
    background: normalizeBackground(facts.background),
    unread,
    awaitingReply: awaitingReply(pending),
    failed,
    pending,
  };
}

/** Combine one task's conversation attention into its card-level attention. */
export function aggregateTaskAttention(values: readonly Attention[]): Attention {
  if (values.length === 0) return EMPTY_ATTENTION;
  let running = false;
  let unread = false;
  let failed = false;
  const background: BackgroundActivity[] = [];
  const pendingValues: PendingUserWork[] = [];
  for (const value of values) {
    running ||= value.running;
    unread ||= value.unread;
    failed ||= value.failed;
    background.push(...value.background);
    pendingValues.push(value.pending);
  }
  const pending = mergePendingUserWork(pendingValues);
  return { running, background: normalizeBackground(background), unread, awaitingReply: awaitingReply(pending), failed, pending };
}

