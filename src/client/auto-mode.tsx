import React from 'react';
import type { AutoModePauseReason, PendingUserWork, PendingUserWorkKind, Task, Workflow } from '../shared/types.js';
import { NO_PENDING_USER_WORK } from '../shared/types.js';
import { activeHold } from '../domain/auto-mode-hold.js';
import { hasUnresolvedEntry } from '../domain/stage-entry.js';
import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { resolveAdvanceRoute } from '../domain/transition-route.js';
import { AutoModeIcon } from './icons.js';

/** The card and drawer state derived from the task's persisted auto mode, transition, and pending user work. */
export type AutoModeViewState = 'off' | 'armed' | 'advancing' | 'failed' | 'paused' | 'paused-by-agent' | 'held' | 'instruction' | 'dead-end';

export interface AutoModeStatus { tone: 'pending' | 'danger'; label: string; alert?: boolean }

export interface AutoModeView {
  enabled: boolean;
  /**
   * The control's pressed state. A recorded pause presents as not pressed even
   * while auto mode is enabled, so the pressed state keeps describing the action
   * activation performs: turning the setting on, which is the pause's resume.
   */
  pressed: boolean;
  state: AutoModeViewState;
  /** Accessible name of the toggle, describing the action it performs. */
  toggleLabel: string;
  title: string;
  /** The status the state itself contributes, presented first. */
  status?: AutoModeStatus;
  /** Recorded pauses presented beside it, in record order (the agent pause first). */
  secondaryStatuses?: AutoModeStatus[];
  /** The sentence for a state that the control itself must communicate. */
  stateLabel?: string;
  destinationName?: string;
  reason?: AutoModePauseReason;
  /** The held state's sentence naming what the user still owes the task; absent outside that state. */
  waitLabel?: string;
}

/** The state one branch presents, before the recorded pauses are folded in. */
interface AutoModePresentation {
  state: AutoModeViewState;
  /** The tooltip sentence the state contributes; a recorded pause may supply it instead. */
  title?: string;
  /** The sentence the control states before its action. */
  label?: string;
  status?: AutoModeStatus;
  destinationName?: string;
  reason?: AutoModePauseReason;
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

/** The short sentence for a pause the agent requested, carrying the reason it recorded. */
export function agentPauseLabel(reason: string): string {
  return 'Auto mode paused by the agent: ' + reason;
}

/** A diagnostic pause is a failure only for the endings a retry cannot fix. */
function pauseTone(reason: AutoModePauseReason): AutoModeStatus['tone'] {
  return reason === 'turn-error' || reason === 'advance-failed' || reason === 'transition-stale' ? 'danger' : 'pending';
}

/** Join presented sentences once, without doubling the terminator the control adds. */
function joinLabels(values: readonly string[]): string {
  let joined = '';
  for (const value of values) {
    const next = value.trim().replace(/\.+$/, '');
    if (next.length === 0) continue;
    joined = joined.length === 0 ? next : joined + (/[.!?…]$/.test(joined) ? ' ' : '. ') + next;
  }
  return joined;
}

/** The precedence table: which state a task presents, before its recorded pauses are folded in. */
function presentationOf(task: Task, workflow: Workflow, pendingWork: PendingUserWork): AutoModePresentation {
  const pending = task.pendingTransition;
  if (pending?.origin === 'auto') {
    const name = stageName(workflow, pending.columnId);
    if (pending.status === 'failed') {
      const label = 'Automatic advance failed' + (pending.error?.message ? ': ' + pending.error.message : '');
      return { state: 'failed', destinationName: name, title: label, label, status: { tone: 'danger', label, alert: true } };
    }
    const label = 'Advancing to ' + name + '…';
    return { state: 'advancing', destinationName: name, title: label, label, status: { tone: 'pending', label } };
  }
  if (task.autoMode?.enabled !== true) return { state: 'off', title: 'Turn on auto mode to advance this task automatically after each completed turn.' };
  // A recorded pause is the whole story when nothing is in flight, so its own record
  // supplies the status, the tooltip, and the accessible name below.
  if (activeHold(task) !== undefined) return { state: 'paused-by-agent' };
  const pause = task.autoMode?.pause;
  if (pause !== undefined) return { state: 'paused', reason: pause.reason };
  // The held state is derived from pending user work, so it is presented by the control
  // alone and never adds a status-strip entry.
  if (hasPendingUserWork(pendingWork)) {
    const waitLabel = pendingWorkLabel(pendingWork);
    return { state: 'held', waitLabel, title: waitLabel + ' The next completed turn advances once nothing of yours is pending.' };
  }
  if (hasUnresolvedEntry(task)) {
    const label = 'Auto mode is waiting for the ' + stageName(workflow, task.columnId) + ' instruction';
    return { state: 'instruction', title: label, label, status: { tone: 'pending', label } };
  }
  const route = resolveAdvanceRoute(workflow, task);
  // A recording that stopped resolving is a pause even before a turn ends, so the
  // control explains it instead of naming a destination that cannot be reached.
  if (route.kind === 'stale') {
    const label = pauseLabel('transition-stale', route.message);
    return { state: 'paused', reason: 'transition-stale', title: label, label, status: { tone: 'danger', label } };
  }
  if (route.kind !== 'advance' || route.plan.destination === undefined) {
    const label = 'Auto mode: no next stage';
    return { state: 'dead-end', title: 'Auto mode is on. No next stage is configured.', label, status: { tone: 'pending', label } };
  }
  const destination = route.plan.destination;
  return {
    state: 'armed',
    destinationName: destination.name,
    title: 'Auto mode is on: the next completed turn moves to ' + destination.name + (route.source === 'recorded' ? ', the transition this task recorded.' : '.'),
  };
}

/**
 * One derivation for the card chip, the drawer chip, and the card status strip.
 * The recorded pauses are folded into every presentation, so a state that comes
 * first — an advance in flight, its failure — never hides the reason the agent
 * gave, on the card or in the drawer.
 */
export function autoModeView(task: Task, workflow: Workflow, pendingWork: PendingUserWork = NO_PENDING_USER_WORK, scriptOwned = false): AutoModeView {
  const enabled = task.autoMode?.enabled === true;
  const hold = activeHold(task);
  const pause = task.autoMode?.pause;
  const recorded: AutoModeStatus[] = [
    ...(hold === undefined ? [] : [{ tone: 'pending' as const, label: agentPauseLabel(hold.reason) }]),
    ...(pause === undefined ? [] : [{ tone: pauseTone(pause.reason), label: pauseLabel(pause.reason, pause.message), ...(pause.reason === 'advance-failed' ? { alert: true } : {}) }]),
  ];
  const presentation: AutoModePresentation = scriptOwned || workflow.columns.find(column => column.id === task.columnId)?.deterministic ? { state: enabled ? 'instruction' : 'off', title: 'Deterministic execution owns this entry. Script results route independently of Auto mode.', label: enabled ? 'Auto mode waits for the deterministic result' : undefined } : presentationOf(task, workflow, pendingWork);
  const statuses = presentation.status === undefined ? recorded : [presentation.status, ...recorded];
  const labels = joinLabels([...(presentation.label === undefined ? [] : [presentation.label]), ...recorded.map(value => value.label)]);
  const title = [presentation.title ?? '', ...recorded.map(value => value.label)].filter(value => value.length > 0).join(' ');
  return {
    enabled,
    pressed: enabled && recorded.length === 0,
    state: presentation.state,
    toggleLabel: recorded.length > 0 ? 'Resume auto mode' : enabled ? 'Turn off auto mode' : 'Turn on auto mode',
    title,
    ...(statuses[0] === undefined ? {} : { status: statuses[0] }),
    ...(statuses.length > 1 ? { secondaryStatuses: statuses.slice(1) } : {}),
    ...(labels.length === 0 ? {} : { stateLabel: labels }),
    ...(presentation.destinationName === undefined ? {} : { destinationName: presentation.destinationName }),
    ...(presentation.reason === undefined ? {} : { reason: presentation.reason }),
    ...(presentation.waitLabel === undefined ? {} : { waitLabel: presentation.waitLabel }),
  };
}

const STATEFUL_LABEL: ReadonlySet<AutoModeViewState> = new Set(['advancing', 'failed', 'paused', 'paused-by-agent', 'instruction', 'dead-end']);

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
 * same behavior. Only their size differs. Activation is described by the pressed
 * state, so a recorded pause resumes the task instead of turning the setting off.
 */
export function AutoModeControl({ view, variant = 'card', pending = false, onToggle }: {
  view: AutoModeView; variant?: 'card' | 'header'; pending?: boolean; onToggle?: (enabled: boolean) => void;
}) {
  const paused = view.state === 'paused' || view.state === 'paused-by-agent' || view.state === 'failed';
  const advancing = view.state === 'advancing';
  const held = view.state === 'held';
  return <button
    type="button"
    className={'kb-auto-chip' + (variant === 'header' ? ' kb-auto-chip-header' : '') + (view.enabled ? ' is-on' : '') + (paused ? ' is-paused' : '') + (advancing ? ' is-advancing' : '') + (held ? ' is-held' : '')}
    data-auto-state={view.state}
    aria-pressed={view.pressed}
    aria-label={controlLabel(view, view.toggleLabel)}
    title={view.title}
    aria-busy={pending ? true : undefined}
    disabled={pending}
    onPointerDown={variant === 'card' ? event => event.stopPropagation() : undefined}
    onClick={event => { if (variant === 'card') event.stopPropagation(); if (!pending) onToggle?.(!view.pressed); }}
  >
    <AutoModeIcon size={variant === 'card' ? 11 : 13} />
    <span>Auto</span>
  </button>;
}
