import type { Attention, BackgroundActivity, BackgroundKind, ConversationFacts } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';

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

/**
 * Project one conversation's durable facts with the client-owned read acknowledgment.
 * Blue and red wait until no owned agent is running, so a delegation that has not
 * finished is never presented as a completed turn.
 */
export function projectConversation(facts: ConversationFacts, status: NativePendingStatus | undefined, acknowledged: number | undefined): Attention {
  const settled = facts.settledTurn;
  const unread = !facts.running && settled !== null && (acknowledged === undefined || settled.seq > acknowledged);
  const failed = !facts.running && settled !== null && settled.outcome === 'error' && (acknowledged === undefined || settled.seq > acknowledged);
  return {
    running: facts.running,
    background: normalizeBackground(facts.background),
    unread,
    awaitingReply: facts.awaitingReply || status?.pendingInteraction !== undefined,
    failed,
  };
}

/** Combine one task's conversation attention into its card-level attention. */
export function aggregateTaskAttention(values: readonly Attention[]): Attention {
  if (values.length === 0) return EMPTY_ATTENTION;
  let running = false;
  let unread = false;
  let awaitingReply = false;
  let failed = false;
  const background: BackgroundActivity[] = [];
  for (const value of values) {
    running ||= value.running;
    unread ||= value.unread;
    awaitingReply ||= value.awaitingReply;
    failed ||= value.failed;
    background.push(...value.background);
  }
  return { running, background: normalizeBackground(background), unread, awaitingReply, failed };
}
