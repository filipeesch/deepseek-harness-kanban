import React, { useRef } from 'react';
import type { Attention, Column, Task } from '../shared/types.js';
import { backgroundAccessibleName, backgroundDetails, backgroundIndicatorText, WorkingAnnouncement, WorkingBadge } from './activity.js';
import { AttentionDots } from './attention-dots.js';
import { autoRunEntryForColumn, RUN_FAILURE_FALLBACK, type AutoRunController } from './auto-run.js';
import { CardInstructionAction, useAutoRunEntry } from './auto-run-view.js';
import { CardAutoModeControl, type AutoModeStatus, type AutoModeView } from './auto-mode.js';
import { AlertIcon, ClockIcon } from './icons.js';

export interface TaskCardProps {
  task: Task;
  column: Column;
  projectName: string;
  attention: Attention;
  selectionMode: boolean;
  selected: boolean;
  autoRun: AutoRunController;
  autoMode: AutoModeView;
  autoModePending?: boolean;
  onToggleAutoMode: (taskId: string, enabled: boolean) => void;
  onOpen: (taskId: string) => void;
  onToggleSelect: (taskId: string) => void;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, taskId: string, columnId: string) => void;
  shouldSuppressClick: () => boolean;
}

export interface CardStatusEntry { key: string; tone: 'danger' | 'pending'; label: string; alert?: boolean }

/** The card's status lines, in a stable order: operation, transition, stage-instruction failure, auto mode. */
export function cardStatusEntries(task: Task, runFailure?: string, autoStatus?: AutoModeStatus): CardStatusEntry[] {
  const entries: CardStatusEntry[] = [];
  if (task.operation) {
    const operation = task.operation;
    const failed = operation.phase === 'failed';
    const destructive = operation.request.kind === 'delete' || operation.request.kind === 'remove';
    const deleteKind = operation.request.kind === 'delete';
    const label = destructive
      ? failed
        ? (deleteKind ? 'Deletion needs attention' : 'Worktree removal needs attention')
        : operation.phase === 'queued'
          ? (deleteKind ? 'Queued to delete' : 'Queued to remove worktree')
          : operation.phase === 'waiting'
            ? (deleteKind ? 'Deletion waiting for idle' : 'Removal waiting for idle')
            : (deleteKind ? 'Deleting…' : 'Removing worktree…')
      : failed ? 'Operation failed' : 'Operation: ' + operation.phase;
    entries.push({ key: 'operation', tone: failed ? 'danger' : 'pending', label });
  }
  if (task.pendingTransition && task.pendingTransition.origin !== 'auto') {
    const failed = task.pendingTransition.status === 'failed';
    entries.push({ key: 'transition', tone: failed ? 'danger' : 'pending', label: failed ? 'Confirmed action failed' : 'Confirmed action: ' + task.pendingTransition.status });
  }
  if (runFailure !== undefined) entries.push({ key: 'instruction', tone: 'danger', label: runFailure, alert: true });
  if (autoStatus !== undefined) entries.push({ key: 'auto', tone: autoStatus.tone, label: autoStatus.label, ...(autoStatus.alert === true ? { alert: true } : {}) });
  return entries;
}

function CardContext({ taskId, title, projectName, attention, selectionMode, selected, autoMode, autoModePending, onToggleAutoMode, onToggleSelect, onActivate }: {
  taskId: string; title: string; projectName: string; attention: Attention; selectionMode: boolean; selected: boolean;
  autoMode: AutoModeView; autoModePending?: boolean; onToggleAutoMode: (taskId: string, enabled: boolean) => void;
  onToggleSelect: (taskId: string) => void; onActivate: () => void;
}) {
  return <div className="kb-card-context" onClick={onActivate}>
    {selectionMode && <input type="checkbox" className="kb-card-select" aria-label={'Select ' + title} checked={selected} onClick={event => event.stopPropagation()} onChange={() => onToggleSelect(taskId)} />}
    <span className="kb-card-project" title={projectName}>{projectName}</span>
    {!selectionMode && <CardAutoModeControl view={autoMode} pending={autoModePending === true} onToggle={enabled => onToggleAutoMode(taskId, enabled)} />}
    <AttentionDots value={attention} label={'Attention for ' + title} />
  </div>;
}

function CardActivity({ attention, label, action, onActivate }: { attention: Attention; label: string; action?: React.ReactNode; onActivate: () => void }) {
  const { running, background } = attention;
  const details = backgroundDetails(background);
  return <div className="kb-card-activity">
    <WorkingAnnouncement running={running} label={label} />
    {running && <WorkingBadge decorative />}
    {background.length > 0 && <span className="kb-background" role="note" tabIndex={0} title={details} aria-label={backgroundAccessibleName(background)} onClick={onActivate}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(); } }}>{backgroundIndicatorText(background)}</span>}
    {action}
  </div>;
}

function CardStatus({ entries }: { entries: readonly CardStatusEntry[] }) {
  if (entries.length === 0) return null;
  return <div className="kb-card-status">
    {entries.map(entry => <p key={entry.key} className={'kb-card-status-line is-' + entry.tone} role={entry.alert ? 'alert' : undefined}>
      {entry.tone === 'danger' ? <AlertIcon size={12} /> : <ClockIcon size={12} />}
      <span>{entry.label}</span>
    </p>)}
  </div>;
}

/** One task card; every board concern arrives through props. */
export function TaskCard({ task, column, projectName, attention, selectionMode, selected, autoRun, autoMode, autoModePending, onToggleAutoMode, onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick }: TaskCardProps) {
  const openButton = useRef<HTMLButtonElement>(null);
  const runEntry = useAutoRunEntry(autoRun, task.id);
  const currentRun = autoRunEntryForColumn(runEntry, column.id);
  const runFailure = currentRun?.status === 'failed' ? currentRun.error?.message ?? RUN_FAILURE_FALLBACK : undefined;
  function activate() {
    openButton.current?.focus();
    if (shouldSuppressClick()) return;
    if (selectionMode) { onToggleSelect(task.id); return; }
    onOpen(task.id);
  }
  return <article className={'kb-card' + (selected ? ' kb-card-selected' : '')} data-task-id={task.id} data-working={attention.running ? 'true' : undefined}
    onPointerDown={event => {
      if (selectionMode) return;
      if ((event.target as Element).closest('.kb-card-activity, .kb-auto-chip, input, select, textarea, a')) return;
      onBeginDrag(event, task.id, task.columnId);
    }}>
    <button ref={openButton} type="button" className="kb-card-open" aria-label={(selectionMode ? 'Select task ' : 'Open task ') + task.title} aria-pressed={selectionMode ? selected : undefined} onClick={activate}>
      <strong>{task.title}</strong>
    </button>
    <CardContext taskId={task.id} title={task.title} projectName={projectName} attention={attention} selectionMode={selectionMode} selected={selected} autoMode={autoMode} autoModePending={autoModePending} onToggleAutoMode={onToggleAutoMode} onToggleSelect={onToggleSelect} onActivate={activate} />
    <CardActivity attention={attention} label={task.title} onActivate={activate} action={!selectionMode ? <CardInstructionAction key={column.id} task={task} column={column} controller={autoRun} /> : undefined} />
    <CardStatus entries={cardStatusEntries(task, runFailure, autoMode.status)} />
  </article>;
}
