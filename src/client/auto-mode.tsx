import React from 'react';
import type { AutoModePauseReason, Task, Workflow } from '../shared/types.js';
import { hasUnresolvedEntry } from '../domain/stage-entry.js';
import { resolveAutoAdvance } from '../domain/auto-advance.js';
import { AutoModeIcon } from './icons.js';

/** The card and drawer state derived from the task's persisted auto mode and transition. */
export type AutoModeState = 'off' | 'armed' | 'advancing' | 'failed' | 'paused' | 'waiting' | 'dead-end';

export interface AutoModeStatus { tone: 'pending' | 'danger'; label: string; alert?: boolean }

export interface AutoModeView {
  enabled: boolean;
  state: AutoModeState;
  /** Accessible name of the toggle, describing the action it performs. */
  toggleLabel: string;
  title: string;
  status?: AutoModeStatus;
  /** The drawer's sentence for the current state; absent when there is nothing to say. */
  notice?: string;
  destinationName?: string;
  reason?: AutoModePauseReason;
}

function stageName(workflow: Workflow, columnId: string): string {
  return workflow.columns.find(column => column.id === columnId)?.name ?? columnId;
}

/** The short pause sentence shared by the card status strip and the drawer notice. */
export function pauseLabel(reason: AutoModePauseReason, message?: string): string {
  const detail = message !== undefined && message.trim() ? ': ' + message.trim() : '';
  switch (reason) {
    case 'turn-error': return 'Auto mode paused: the turn failed';
    case 'turn-blocked': return 'Auto mode paused: the turn is waiting for you';
    case 'turn-aborted': return 'Auto mode paused: the turn was stopped';
    case 'turn-max-tokens': return 'Auto mode paused: the turn reached its token limit';
    case 'advance-failed': return 'Auto mode could not advance' + detail;
  }
}

/** One derivation for the card chip, the status strip, and the drawer notice. */
export function autoModeView(task: Task, workflow: Workflow): AutoModeView {
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
      return { ...base, state: 'failed', destinationName: name, status: { tone: 'danger', label, alert: true }, notice: label };
    }
    const label = 'Advancing to ' + name + '…';
    return { ...base, state: 'advancing', destinationName: name, status: { tone: 'pending', label }, notice: label };
  }
  if (!enabled) return { ...base, state: 'off' };
  const pause = task.autoMode?.pause;
  if (pause !== undefined) {
    const label = pauseLabel(pause.reason, pause.message);
    const tone: AutoModeStatus['tone'] = pause.reason === 'turn-error' || pause.reason === 'advance-failed' ? 'danger' : 'pending';
    return { ...base, state: 'paused', reason: pause.reason, status: { tone, label, ...(pause.reason === 'advance-failed' ? { alert: true } : {}) }, notice: label };
  }
  if (hasUnresolvedEntry(task)) {
    const label = 'Auto mode is waiting for the ' + stageName(workflow, task.columnId) + ' instruction';
    return { ...base, state: 'waiting', status: { tone: 'pending', label }, notice: label };
  }
  const destination = resolveAutoAdvance(workflow, task.columnId).destination;
  if (destination === undefined) {
    const label = 'Auto mode: no next stage';
    return { ...base, state: 'dead-end', status: { tone: 'pending', label }, notice: 'Auto mode is on. No next stage is configured.' };
  }
  return { ...base, state: 'armed', destinationName: destination.name, notice: 'Auto mode is on: the next completed turn moves to ' + destination.name + '.' };
}

/** The card's always-visible toggle and state indicator. */
export function CardAutoModeControl({ view, pending = false, onToggle }: { view: AutoModeView; pending?: boolean; onToggle?: (enabled: boolean) => void }) {
  const paused = view.state === 'paused' || view.state === 'failed';
  const advancing = view.state === 'advancing';
  return <button
    type="button"
    className={'kb-auto-chip' + (view.enabled ? ' is-on' : '') + (paused ? ' is-paused' : '') + (advancing ? ' is-advancing' : '')}
    data-auto-state={view.state}
    aria-pressed={view.enabled}
    aria-label={view.toggleLabel}
    title={view.title}
    aria-busy={pending ? true : undefined}
    disabled={pending}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); if (!pending) onToggle?.(!view.enabled); }}
  >
    <AutoModeIcon size={11} />
    <span>Auto</span>
  </button>;
}

/** The drawer header's mirrored toggle, labelled with its current state. */
export function DrawerAutoModeToggle({ view, pending = false, disabled = false, onToggle }: { view: AutoModeView; pending?: boolean; disabled?: boolean; onToggle?: (enabled: boolean) => void }) {
  return <button
    type="button"
    className={'kb-button kb-drawer-auto' + (view.enabled ? ' is-on' : '') + (view.state === 'paused' || view.state === 'failed' ? ' is-paused' : '')}
    data-auto-state={view.state}
    aria-pressed={view.enabled}
    aria-label={view.enabled ? 'Auto mode: on' : 'Auto mode: off'}
    title={view.title}
    aria-busy={pending ? true : undefined}
    disabled={disabled || pending}
    onClick={() => onToggle?.(!view.enabled)}
  >
    <AutoModeIcon size={13} />
    <span>{view.enabled ? 'Auto mode: on' : 'Auto mode: off'}</span>
  </button>;
}

/** The drawer's automatic-advance notice, shown above the section panel. */
export function AutoModeNotice({ view }: { view: AutoModeView }) {
  if (view.notice === undefined) return null;
  const failure = view.status?.tone === 'danger';
  return <div className={'kb-drawer-automode' + (failure ? ' kb-drawer-automode-failed' : '')} data-auto-state={view.state}>
    <p role={view.status?.alert ? 'alert' : undefined}>{view.notice}</p>
  </div>;
}
