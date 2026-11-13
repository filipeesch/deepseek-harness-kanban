import type { DeterministicHold, DeterministicHoldBackground, DeterministicResult } from '../shared/deterministic.js';
import type { PendingUserWorkKind } from '../shared/types.js';
import type { ConversationBlocker, ConversationIdleReport } from '../shared/conversation-idle.js';
import { isBackgroundBlocker, isUserWorkBlocker } from '../shared/conversation-idle.js';

/** At most three background facts are ever stored, so the record stays bounded. */
export const HOLD_BACKGROUND_LIMIT = 3;
/** One stored background label is bounded; the drawer shows it verbatim. */
export const HOLD_LABEL_LIMIT = 200;
const TRUNCATED = '…';

/** The task facts a delivery decision reads. Structurally satisfied by the located task. */
export interface HoldTaskFacts {
  operation: unknown | null;
  pendingTransition?: unknown;
  worktree: { status: 'preparing' | 'ready' | 'error' } | null;
  autoMode?: { hold?: unknown };
  sessionIds: readonly string[];
  closedSessionIds: readonly string[];
  effectiveCwd: string;
  stageEntry?: { id: string };
  deterministic?: {
    entryId: string;
    executionId: string;
    attemptId?: string;
    phase: string;
    capture?: { directory: 'task' | 'project'; executionDirectory: string };
    result?: DeterministicResult;
  };
}
/** The project facts a delivery decision reads. */
export interface HoldProjectFacts { operation?: unknown; projectPath?: string }
/** The exact authority the supervisor routed; a mismatch is a stale request, not a user-facing wait. */
export interface HoldRequestFacts {
  control: { entryId: string; executionId: string; attemptId?: string; phase: string };
  result: { id: string; deliveryId?: string };
}
/** One conversation's readiness report in the order the task lists its conversations. */
export interface HoldConversation extends ConversationIdleReport { sessionId: string }
export interface DeterministicHoldInput {
  task: HoldTaskFacts;
  project: HoldProjectFacts;
  request: HoldRequestFacts;
  /** Context admission reserved by the host. */
  reserved: boolean;
  /** The task-wide pending user work, already merged across its conversations. */
  pending: readonly PendingUserWorkKind[];
  /** Reports for every open conversation of the task. */
  conversations: readonly HoldConversation[];
  /** The observation instant stored with the record. */
  at: string;
}

function hold(code: DeterministicHold['code'], input: DeterministicHoldInput, facts?: Pick<DeterministicHold, 'background' | 'pending'>): DeterministicHold {
  return { code, at: input.at, ...facts };
}
/** Bound one label so a long command never inflates the stored record. */
export function boundHoldLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length <= HOLD_LABEL_LIMIT ? trimmed : trimmed.slice(0, HOLD_LABEL_LIMIT - TRUNCATED.length) + TRUNCATED;
}
function uniqueKinds(kinds: readonly PendingUserWorkKind[]): PendingUserWorkKind[] {
  return [...new Set(kinds)];
}
function backgroundFacts(blockers: readonly ConversationBlocker[]): DeterministicHoldBackground[] {
  return blockers.filter(isBackgroundBlocker).slice(0, HOLD_BACKGROUND_LIMIT).map(blocker => ({
    kind: blocker.family,
    ...(blocker.id === undefined ? {} : { id: blocker.id }),
    label: boundHoldLabel(blocker.label),
  }));
}
function pendingKinds(blockers: readonly ConversationBlocker[]): PendingUserWorkKind[] {
  const kinds: PendingUserWorkKind[] = [];
  for (const blocker of blockers) {
    if (!isUserWorkBlocker(blocker)) continue;
    kinds.push(blocker.family === 'question' ? 'native-question' : 'approval');
  }
  return uniqueKinds(kinds);
}
function authorityCurrent(input: DeterministicHoldInput): boolean {
  const control = input.task.deterministic; const request = input.request;
  return control !== undefined && input.task.stageEntry?.id === request.control.entryId
    && control.entryId === request.control.entryId && control.executionId === request.control.executionId
    && control.attemptId === request.control.attemptId && control.phase === 'delivering'
    && control.result?.id === request.result.id
    && (control.result.deliveryId ?? undefined) === (request.result.deliveryId ?? undefined)
    && control.result.deliveryStatus !== 'accepted' && control.result.deliveryStatus !== 'failed';
}
/**
 * Why this saved result cannot be delivered right now, in the order a user can act on:
 * the request's own authority, then the task/project context, then pending user work,
 * then the conversations that still own work. Nothing here mutates or awaits.
 */
export function evaluateDeterministicHold(input: DeterministicHoldInput): DeterministicHold | undefined {
  if (!authorityCurrent(input)) return hold('stale-authority', input);
  const { task, project } = input;
  if (task.operation !== null) return hold('task-operation', input);
  if (project.operation !== undefined) return hold('project-operation', input);
  if (task.pendingTransition !== undefined) return hold('pending-transition', input);
  if (task.worktree !== null && task.worktree.status !== 'ready') return hold('worktree-not-ready', input);
  if (!project.projectPath) return hold('project-directory-missing', input);
  const capture = task.deterministic?.capture;
  const directory = capture?.directory === 'project' ? project.projectPath : task.effectiveCwd;
  if (capture !== undefined && capture.executionDirectory !== directory) return hold('execution-directory-changed', input);
  if (task.autoMode?.hold !== undefined) return hold('auto-mode-hold', input);
  if (input.reserved) return hold('context-reserved', input);
  const pending = uniqueKinds(input.pending);
  if (pending.length > 0) return hold('pending-user-work', input, { pending });
  for (const conversation of input.conversations) {
    if (conversation.idle) continue;
    const background = backgroundFacts(conversation.blockers);
    if (background.length > 0) return hold('background-work', input, { background });
    const waiting = pendingKinds(conversation.blockers);
    if (waiting.length > 0) return hold('pending-user-work', input, { pending: waiting });
    return hold('conversation-active', input);
  }
  return undefined;
}
/** Whether two observations describe the same refusal, ignoring when each was seen. */
export function sameDeterministicHold(left: DeterministicHold | undefined, right: DeterministicHold | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.code !== right.code) return false;
  const leftPending = left.pending ?? []; const rightPending = right.pending ?? [];
  if (leftPending.length !== rightPending.length || leftPending.some((kind, index) => kind !== rightPending[index])) return false;
  const leftBackground = left.background ?? []; const rightBackground = right.background ?? [];
  return leftBackground.length === rightBackground.length && leftBackground.every((fact, index) => {
    const other = rightBackground[index]!;
    return fact.kind === other.kind && fact.id === other.id && fact.label === other.label;
  });
}
