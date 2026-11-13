import React, { useEffect, useState } from 'react';
import type { Column, Task } from '../shared/types.js';
import type { DeterministicSummary } from '../shared/deterministic.js';
import { useDeterministicEnvironment, useScriptSummary } from './deterministic-context.js';
import { ownedScript, scriptAwaitingApproval } from './deterministic-view.js';
import { ScriptParametersDialog } from './deterministic-parameters.js';
import { useScriptReview } from './script-review-provider.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';
import { PlayIcon } from './icons.js';

/** Independent action state: a slow script never turns the whole board into Saving. */
export function ScriptActions({ task, column, summary, run, compact = false }: {
  task: Task; column: Column | undefined; summary?: DeterministicSummary; run: RunCommand; compact?: boolean;
}) {
  const action = useAction(run);
  const environment = useDeterministicEnvironment();
  const openReview = useScriptReview();
  const [editingParameters, setEditingParameters] = useState(false);
  const owned = ownedScript(task, summary);
  const declared = column?.deterministic?.params ?? [];
  const editableParameters = owned !== undefined && declared.length > 0 && !['active', 'stopping'].includes(owned.phase);
  if (!owned && !column?.deterministic) return null;
  const awaiting = scriptAwaitingApproval(owned);
  const stoppable = owned !== undefined && ['capture-pending', 'active'].includes(owned.phase);
  const stopping = owned?.phase === 'stopping';
  const busy = action.pending || stopping;
  const play = !stoppable && !awaiting && !stopping;
  const className = compact ? 'kb-button kb-card-action' : 'kb-button';
  // A failed saved delivery keeps its result identity; rerunning is a separate
  // action, so its accessible name must match the visible "Run again" label.
  const deliveryFailed = owned?.deliveryStatus === 'failed';
  const label = awaiting ? 'Approve and run deterministic script' : stoppable ? 'Stop deterministic script' : deliveryFailed ? 'Run again — deterministic script' : 'Play deterministic script';
  const disabled = busy || (play && (!column?.deterministic || Boolean(task.operation || task.pendingTransition))) || (awaiting && environment?.boardId === undefined);
  const primary = awaiting
    ? () => { if (environment?.boardId !== undefined) void openReview({ boardId: environment.boardId, stageId: task.columnId, taskId: task.id }); }
    : () => void action.execute(stoppable ? { type: 'task.deterministicStop', taskId: task.id, executionId: owned!.executionId } : { type: 'task.deterministicPlay', taskId: task.id });

  return <div className={compact ? 'kb-script-actions kb-card-run' : 'kb-script-actions'} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" className={className} aria-label={label} title={action.error?.message ?? (play && !column?.deterministic ? 'Configure a deterministic script or change stage before Play.' : label)} aria-busy={busy || undefined} disabled={disabled} onClick={primary}>
      {busy ? '…' : awaiting ? 'Approve and run' : stoppable ? compact ? <span aria-hidden="true">■</span> : 'Stop' : compact ? <PlayIcon size={15} /> : deliveryFailed ? 'Run again' : 'Play'}
    </button>
    {!awaiting && deliveryFailed && <button type="button" className={className} aria-label="Retry delivery — deterministic result" title={action.error?.message ?? 'Deliver the saved result again without running the script.'} aria-busy={busy || undefined} disabled={busy} onClick={() => void action.execute({ type: 'task.deterministicRetryDelivery', taskId: task.id, entryId: owned!.entryId, executionId: owned!.executionId })}>{compact ? <span aria-hidden="true">↻</span> : 'Retry delivery'}</button>}
    {editableParameters && !compact && <button type="button" className={className} aria-label="Edit deterministic script parameters" title="Edit the values this stage entry passes to the script" disabled={busy} onClick={() => setEditingParameters(true)}>{compact ? <span aria-hidden="true">⚙</span> : 'Edit parameters'}</button>}
    {editingParameters && owned && <ScriptParametersDialog key={owned.entryId} task={task} column={column} summary={owned} run={run} onClose={() => setEditingParameters(false)} />}
    {!compact && <ErrorNotice problem={action.error} />}
    {compact && action.error && <span className="kb-sr" role="alert">{action.error.message}</span>}
  </div>;
}
export function CardScriptActions({ task, column }: { task: Task; column: Column }) {
  const environment = useDeterministicEnvironment();
  const summary = useScriptSummary(task.id);
  if (environment === null) return null;
  return <ScriptActions task={task} column={column} summary={summary} run={environment.run} compact />;
}

/** Read-only entry values plus editing for a parameterized stage, inside the card status region. */
export function CardScriptParameters({ task, column, selectionMode = false }: { task: Task; column: Column; selectionMode?: boolean }) {
  // Rendered inside the existing status region: read-only entry values plus an
  // inline edit action. It never adds an activity control or a new card region.
  const environment = useDeterministicEnvironment();
  const summary = useScriptSummary(task.id);
  const [editing, setEditing] = useState(false);
  const owned = ownedScript(task, summary);
  const declared = column.deterministic?.params ?? [];
  useEffect(() => { setEditing(false); }, [owned?.entryId]);
  if (environment === null || owned === undefined || declared.length === 0) return null;
  const editable = !selectionMode && !['active', 'stopping'].includes(owned.phase);
  const values = declared.map(parameter => parameter.name + '=' + (owned.parameters?.[parameter.name] || '—'));
  return <div className="kb-card-parameters" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <span className="kb-card-parameters-values" title={values.join(' · ')}>{values.join(' · ')}</span>
    {editable && <button type="button" className="kb-card-parameter-edit" aria-label="Edit deterministic script parameters" onClick={() => setEditing(true)}>Edit parameters</button>}
    {editing && <ScriptParametersDialog key={owned.entryId} task={task} column={column} summary={owned} run={environment.run} onClose={() => setEditing(false)} />}
  </div>;
}
