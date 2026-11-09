import React from 'react';
import type { AutoModePauseReason, PendingUserWork, PendingUserWorkKind, Task, Workflow } from '../shared/types.js';
import { NO_PENDING_USER_WORK } from '../shared/types.js';
import { hasUnresolvedEntry } from '../domain/stage-entry.js';
import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { resolveAdvanceRoute } from '../domain/transition-route.js';
import { AutoModeIcon } from './icons.js';

/** The card and drawer state derived from the task's persisted auto mode, transition, and pending user work. */
export type AutoModeState = 'off' | 'armed' | 'advancing' | 'failed' | 'paused' | 'held' | 'instruction' | 'dead-end';

export interface AutoModeStatus { tone: 'pending' | 'danger'; label: string; alert?: boolean }

export interface AutoModeView {
  enabled: boolean;
  state: AutoModeState;
  /** Accessible name of the toggle, describing the action it performs. */
  toggleLabel: string;
  title: string;
  status?: AutoModeStatus;
  /** The sentence for a state that the control itself must communicate. */
  stateLabel?: string;
  destinationName?: string;
  reason?: AutoModePauseReason;
  /** The held state's sentence naming what the user still owes the task; absent outside that state. */
  waitLabel?: string;
}

function stageName(workflow: Workflow, columnId: string): string {
  return workflow.columns.find(column => column.id === columnId)?.name ?? columnId;
}

function pendingKindLabel(kind: PendingUserWorkKind, queued: number): string {
  switch (kind) {
    case 'decision-question': return 'an unanswered question';
    case 'native-question': return 'an unanswered agent question';
    case 'approval': return 'a pending approval';
    case 'queued-prompt': return queued === 1 ? '1 queued message' : queued + ' queued messages';
  }
}

/** The held sentence: what the user still owes, in the order the pending value keeps. */
export function pendingWorkLabel(pending: PendingUserWork): string {
  const parts = pending.kinds.map(kind => pendingKindLabel(kind, pending.queuedPrompts));
  return 'Auto mode is waiting for you: ' + parts.join(', ') + '.';
}

/** The short pause sentence shared by the card status strip and the auto-mode control. */
export function pauseLabel(reason: AutoModePauseReason, message?: string): string {
  const detail = message !== undefined && message.trim() ? ': ' + message.trim() : '';
  switch (reason) {
    case 'turn-error': return 'Auto mode paused: the turn failed';
    case 'turn-blocked': return 'Auto mode paused: the turn is waiting for you';
    case 'turn-aborted': return 'Auto mode paused: the turn was stopped';
    case 'turn-max-tokens': return 'Auto mode paused: the turn reached its token limit';
    case 'advance-failed': return 'Auto mode could not advance' + detail;
    case 'transition-stale': return 'Auto mode paused: the recorded transition is no longer valid' + detail;
  }
}

/** One derivation for the card chip, the drawer chip, and the card status strip. */
export function autoModeView(task: Task, workflow: Workflow, pendingWork: PendingUserWork = NO_PENDING_USER_WORK): AutoModeView {
  const enabled = task.autoMode?.enabled === true;
  const base = {
    enabled,
    toggleLabel: enabled ? 'Turn off auto mode' : 'Turn on auto mode',
    title: enabled
      ? 'Auto mode is on: each completed turn advances this task to its next configured stage.'
      : 'Turn on auto mode to advance this task automatically after each completed turn.',
  };
  const pending = task.pendingTransition;
  if (pending?.origin === 'auto') {
    const name = stageName(workflow, pending.columnId);
    if (pending.status === 'failed') {
      const label = 'Automatic advance failed' + (pending.error?.message ? ': ' + pending.error.message : '');
      return { ...base, state: 'failed', destinationName: name, status: { tone: 'danger', label, alert: true }, stateLabel: label, title: label };
    }
    const label = 'Advancing to ' + name + '…';
    return { ...base, state: 'advancing', destinationName: name, status: { tone: 'pending', label }, stateLabel: label, title: label };
  }
  if (!enabled) return { ...base, state: 'off' };
  const pause = task.autoMode?.pause;
  if (pause !== undefined) {
    const label = pauseLabel(pause.reason, pause.message);
    const tone: AutoModeStatus['tone'] = pause.reason === 'turn-error' || pause.reason === 'advance-failed' || pause.reason === 'transition-stale' ? 'danger' : 'pending';
    return { ...base, state: 'paused', reason: pause.reason, status: { tone, label, ...(pause.reason === 'advance-failed' ? { alert: true } : {}) }, stateLabel: label, title: label };
  }
  // The held state is derived from pending user work, so it is presented by the control
  // alone and never adds a status-strip entry.
  if (hasPendingUserWork(pendingWork)) {
    const waitLabel = pendingWorkLabel(pendingWork);
    return { ...base, state: 'held', waitLabel, title: waitLabel + ' The next completed turn advances once nothing of yours is pending.' };
  }
  if (hasUnresolvedEntry(task)) {
    const label = 'Auto mode is waiting for the ' + stageName(workflow, task.columnId) + ' instruction';
    return { ...base, state: 'instruction', status: { tone: 'pending', label }, stateLabel: label, title: label };
  }
  const route = resolveAdvanceRoute(workflow, task);
  // A recording that stopped resolving is a pause even before a turn ends, so the
  // control explains it instead of naming a destination that cannot be reached.
  if (route.kind === 'stale') {
    const label = pauseLabel('transition-stale', route.message);
    return { ...base, state: 'paused', reason: 'transition-stale', status: { tone: 'danger', label }, stateLabel: label, title: label };
  }
  if (route.kind !== 'advance' || route.plan.destination === undefined) {
    const label = 'Auto mode: no next stage';
    return { ...base, state: 'dead-end', status: { tone: 'pending', label }, stateLabel: label, title: 'Auto mode is on. No next stage is configured.' };
  }
  const destination = route.plan.destination;
  return { ...base, state: 'armed', destinationName: destination.name, title: 'Auto mode is on: the next completed turn moves to ' + destination.name + (route.source === 'recorded' ? ', the transition this task recorded.' : '.') };
}

const STATEFUL_LABEL: ReadonlySet<AutoModeState> = new Set(['advancing', 'failed', 'paused', 'instruction', 'dead-end']);

/** End a sentence with punctuation only when it does not already have some. */
function sentence(label: string): string {
  return /[.!?…]$/.test(label) ? label : label + '.';
}

/** The control's accessible name: a held or stateful control states its situation before its action. */
function controlLabel(view: AutoModeView, action: string): string {
  if (view.waitLabel !== undefined) return view.waitLabel + ' ' + action;
  if (view.stateLabel !== undefined && STATEFUL_LABEL.has(view.state)) return sentence(view.stateLabel) + ' ' + action;
  return action;
}

/**
 * The one automatic-mode control: the card chip and the drawer header chip share
 * every state, the state sentence in the tooltip and accessible name, and the
 * same toggle behavior. Only their size differs.
 */
export function AutoModeControl({ view, variant = 'card', pending = false, onToggle }: {
  view: AutoModeView; variant?: 'card' | 'header'; pending?: boolean; onToggle?: (enabled: boolean) => void;
}) {
  const paused = view.state === 'paused' || view.state === 'failed';
  const advancing = view.state === 'advancing';
  const held = view.state === 'held';
  return <button
    type="button"
    className={'kb-auto-chip' + (variant === 'header' ? ' kb-auto-chip-header' : '') + (view.enabled ? ' is-on' : '') + (paused ? ' is-paused' : '') + (advancing ? ' is-advancing' : '') + (held ? ' is-held' : '')}
    data-auto-state={view.state}
    aria-pressed={view.enabled}
    aria-label={controlLabel(view, view.toggleLabel)}
    title={view.title}
    aria-busy={pending ? true : undefined}
    disabled={pending}
    onPointerDown={variant === 'card' ? event => event.stopPropagation() : undefined}
    onClick={event => { if (variant === 'card') event.stopPropagation(); if (!pending) onToggle?.(!view.enabled); }}
  >
    <AutoModeIcon size={variant === 'card' ? 11 : 13} />
    <span>Auto</span>
  </button>;
}
