import React, { useRef } from 'react';
import type { Attention, Column, Task } from '../shared/types.js';
import type { TransitionDestination } from '../domain/transitions.js';
import { WorkingAnnouncement } from './activity.js';
import { AttentionDots } from './attention-dots.js';
import { autoRunEntryForColumn, RUN_FAILURE_FALLBACK, type AutoRunController, type AutoRunInput } from './auto-run.js';
import { CardInstructionAction, useAutoRunEntry } from './auto-run-view.js';
import { AutoModeControl, type AutoModeView } from './auto-mode.js';
import { cardStatusEntries, type CardStatusEntry } from './card-status-entries.js';
import { projectCardDominance } from '../domain/card-presence.js';
import { CardScriptActions } from './deterministic-actions.js';
import { useScriptSummary } from './deterministic-context.js';
import { ownedScript, scriptActive, scriptLabel } from './deterministic-view.js';
import { advanceStageLabel } from './stage-advance.js';
import { AdvanceStageIcon, AlertIcon, ClockIcon } from './icons.js';

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
  /** The next workflow stage, when the card may advance the task. */
  next?: TransitionDestination;
  /** Moves the task to the next stage through the board's move pipeline. */
  onMove?: (column: Column) => Promise<unknown> | void;
  /** True while a move from this card is in flight; the board owns it by task id. */
  advancePending?: boolean;
  /** Prepares the first execution before the card's run action sends anything. */
  onRun?: (input: AutoRunInput) => void;
  /** Changes when a transit reached this card, so its arrival pulse replays. */
  arrivalToken?: number;
  /** Clears the arrival pulse once the card presented that exact token. */
  onArrivalEnd?: (taskId: string, token: number) => void;
}

function CardContext({ taskId, title, projectName, attention, selectionMode, selected, onToggleSelect, onActivate }: {
  taskId: string; title: string; projectName: string; attention: Attention; selectionMode: boolean; selected: boolean;
  onToggleSelect: (taskId: string) => void; onActivate: () => void;
}) {
  return <div className="kb-card-context" onClick={onActivate}>
    {selectionMode && <input type="checkbox" className="kb-card-select" aria-label={'Select ' + title} checked={selected} onClick={event => event.stopPropagation()} onChange={() => onToggleSelect(taskId)} />}
    <span className="kb-card-project" title={projectName}>{projectName}</span>
    <AttentionDots value={attention} label={'Attention for ' + title} />
  </div>;
}

function CardActivity({ attention, label, controls, script }: { attention: Attention; label: string; controls: React.ReactNode; script?: string }) {
  return <div className="kb-card-activity">
    <WorkingAnnouncement running={attention.running} label={label} />
    {script && <span className="kb-script-card-label" role="status" title={script}>{script}</span>}
    <div className="kb-card-actions">{controls}</div>
  </div>;
}

function CardAdvanceAction({ next, disabled, onMove }: { next: TransitionDestination; disabled: boolean; onMove: () => void }) {
  const label = advanceStageLabel(next);
  return <button
    type="button"
    className="kb-button kb-card-action"
    aria-label={label}
    title={label}
    disabled={disabled}
    onPointerDown={event => event.stopPropagation()}
    onClick={onMove}
  ><AdvanceStageIcon size={15} /></button>;
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
export function TaskCard({ task, column, projectName, attention, selectionMode, selected, autoRun, autoMode, autoModePending, onToggleAutoMode, onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick, next, onMove, advancePending = false, onRun, arrivalToken, onArrivalEnd }: TaskCardProps) {
  const openButton = useRef<HTMLButtonElement>(null);
  const script = ownedScript(task, useScriptSummary(task.id));
  const activeScript = scriptActive(script);
  const presence = projectCardDominance(attention);
  const runEntry = useAutoRunEntry(autoRun, task.id);
  const currentRun = autoRunEntryForColumn(runEntry, column.id);
  const runFailure = currentRun?.status === 'failed' ? currentRun.error?.message ?? RUN_FAILURE_FALLBACK : undefined;
  const blocked = Boolean(task.operation || task.pendingTransition);
  function activate() {
    openButton.current?.focus();
    if (shouldSuppressClick()) return;
    if (selectionMode) { onToggleSelect(task.id); return; }
    onOpen(task.id);
  }
  const advance = () => {
    if (next === undefined || onMove === undefined || advancePending || blocked) return;
    void onMove(next.column);
  };
  const controls = selectionMode ? null : <>
    <AutoModeControl view={autoMode} pending={autoModePending === true} onToggle={enabled => onToggleAutoMode(task.id, enabled)} />
    <CardScriptActions task={task} column={column} />
    {!script && <CardInstructionAction key={column.id} task={task} column={column} controller={autoRun} {...(onRun === undefined ? {} : { onRun })} />}
    {next !== undefined && !attention.running && <CardAdvanceAction next={next} disabled={blocked || advancePending} onMove={advance} />}
  </>;
  return <article className={'kb-card' + (selected ? ' kb-card-selected' : '')} data-task-id={task.id} data-working={attention.running || activeScript ? 'true' : undefined} data-presence={presence}
    onPointerDown={event => {
      if (selectionMode) return;
      if ((event.target as Element).closest('.kb-card-activity, .kb-auto-chip, input, select, textarea, a')) return;
      onBeginDrag(event, task.id, task.columnId);
    }}>
    <button ref={openButton} type="button" className="kb-card-open" aria-label={(selectionMode ? 'Select task ' : 'Open task ') + task.title} aria-pressed={selectionMode ? selected : undefined} onClick={activate}>
      <strong>{task.title}</strong>
    </button>
    <CardContext taskId={task.id} title={task.title} projectName={projectName} attention={attention} selectionMode={selectionMode} selected={selected} onToggleSelect={onToggleSelect} onActivate={activate} />
    <CardActivity attention={attention} label={task.title} controls={controls} script={script ? scriptLabel(script) : undefined} />
    <CardStatus entries={[...cardStatusEntries(task, runFailure, autoMode.status, autoMode.secondaryStatuses), ...(script?.error ? [{ key: 'script-error', tone: 'danger' as const, label: script.error.message.slice(0, 512), alert: true }] : [])]} />
    {arrivalToken !== undefined && <span key={arrivalToken} className="kb-card-arrival" aria-hidden="true" onAnimationEnd={() => onArrivalEnd?.(task.id, arrivalToken)} />}
  </article>;
}
