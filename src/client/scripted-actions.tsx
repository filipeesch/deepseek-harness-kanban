import React, { useEffect, useState } from 'react';
import type { Column, Task } from '../shared/types.js';
import type { ScriptedSummary } from '../shared/scripted.js';
import { useScriptedEnvironment, useScriptSummary } from './scripted-context.js';
import { ownedScript, scriptAwaitingApproval } from './scripted-view.js';
import { ScriptParametersDialog } from './scripted-parameters.js';
import { useScriptReview } from './script-review-provider.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';
import { PlayIcon } from './icons.js';

/** Independent action state: a slow script never turns the whole board into Saving. */
export function ScriptActions({ task, column, summary, run, compact = false, onReview }: {
  task: Task; column: Column | undefined; summary?: ScriptedSummary; run: RunCommand; compact?: boolean; onReview?: () => void;
}) {
  const action = useAction(run);
  const environment = useScriptedEnvironment();
  const openReview = useScriptReview();
  const [editingParameters, setEditingParameters] = useState(false);
  const owned = ownedScript(task, summary);
  const declared = column?.scripted?.params ?? [];
  const editableParameters = owned !== undefined && declared.length > 0 && !['active', 'stopping'].includes(owned.phase);
  if (!owned && !column?.scripted) return null;
  const awaiting = scriptAwaitingApproval(owned);
  const stoppable = !awaiting && owned !== undefined && ['capture-pending', 'active'].includes(owned.phase);
  const stopping = owned?.phase === 'stopping';
  const busy = action.pending || stopping;
  const play = !stoppable && !awaiting && !stopping;
  const className = compact ? 'kb-button kb-card-action' : 'kb-button';
  // A saved result is delivered, never re-run: Play keeps its result identity and the
  // explicit Run again action is the only path that captures and executes again.
  const saved = !awaiting && owned !== undefined && owned.exit !== undefined && owned.deliveryStatus !== 'accepted';
  const canRunAgain = saved && owned !== undefined && !stoppable && !stopping;
  const label = awaiting ? 'Approve and run script' : stoppable ? 'Stop script' : saved ? 'Deliver saved result — script' : 'Play script';
  const blockedByContext = Boolean(task.operation || task.pendingTransition);
  const disabled = busy || (awaiting && environment?.boardId === undefined) || (!stoppable && !awaiting && ((!saved && !column?.scripted) || blockedByContext));
  const primary = awaiting
    ? () => { if (environment?.boardId !== undefined) void openReview({ boardId: environment.boardId, stageId: task.columnId, taskId: task.id }); }
    : () => void action.execute(stoppable ? { type: 'task.scriptedStop', taskId: task.id, executionId: owned!.executionId } : { type: 'task.scriptedPlay', taskId: task.id });

  return <div className={compact ? 'kb-script-actions kb-card-run' : 'kb-script-actions'} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" className={className} aria-label={label} title={action.error?.message ?? (play && !column?.scripted ? 'Configure a script or change stage before Play.' : label)} aria-busy={busy || undefined} disabled={disabled} onClick={primary}>
      {busy ? '…' : awaiting ? 'Approve and run' : stoppable ? compact ? <span aria-hidden="true">■</span> : 'Stop' : compact ? <PlayIcon size={15} /> : saved ? 'Deliver' : 'Play'}
    </button>
    {canRunAgain && !compact && <button type="button" className={className} aria-label="Run again — script" title={action.error?.message ?? 'Start a new execution of this entry without using the saved result.'} aria-busy={busy || undefined} disabled={busy} onClick={() => void action.execute({ type: 'task.scriptedRunAgain', taskId: task.id, entryId: owned!.entryId })}>{compact ? <span aria-hidden="true">↻</span> : 'Run again'}</button>}
    {editableParameters && !compact && <button type="button" className={className} aria-label="Edit script parameters" title="Edit the values this stage entry passes to the script" disabled={busy} onClick={() => setEditingParameters(true)}>{compact ? <span aria-hidden="true">⚙</span> : 'Edit parameters'}</button>}
    {onReview && <button type="button" className={className} onClick={onReview} aria-label="Review script and local settings">{compact ? '⋯' : 'Review / local settings'}</button>}
    {editingParameters && owned && <ScriptParametersDialog key={owned.entryId} task={task} column={column} summary={owned} run={run} onClose={() => setEditingParameters(false)} />}
    {!compact && <ErrorNotice problem={action.error} />}
    {compact && action.error && <span className="kb-sr" role="alert">{action.error.message}</span>}
  </div>;
}
export function CardScriptActions({ task, column }: { task: Task; column: Column }) {
  const environment = useScriptedEnvironment();
  const summary = useScriptSummary(task.id);
  if (environment === null) return null;
  return <ScriptActions task={task} column={column} summary={summary} run={environment.run} compact />;
}

/** Read-only entry values plus editing for a parameterized stage, inside the card status region. */
export function CardScriptParameters({ task, column, selectionMode = false }: { task: Task; column: Column; selectionMode?: boolean }) {
  const environment = useScriptedEnvironment();
  const summary = useScriptSummary(task.id);
  const [editing, setEditing] = useState(false);
  const owned = ownedScript(task, summary);
  const declared = column.scripted?.params ?? [];
  useEffect(() => { setEditing(false); }, [owned?.entryId]);
  if (environment === null || owned === undefined || declared.length === 0) return null;
  const editable = !selectionMode && !['active', 'stopping'].includes(owned.phase);
  const values = declared.map(parameter => parameter.name + '=' + (owned.parameters?.[parameter.name] || '—'));
  return <div className="kb-card-parameters" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <span className="kb-card-parameters-values" title={values.join(' · ')}>{values.join(' · ')}</span>
    {editable && <button type="button" className="kb-card-parameter-edit" aria-label="Edit script parameters" onClick={() => setEditing(true)}>Edit parameters</button>}
    {editing && <ScriptParametersDialog key={owned.entryId} task={task} column={column} summary={owned} run={environment.run} onClose={() => setEditing(false)} />}
  </div>;
}