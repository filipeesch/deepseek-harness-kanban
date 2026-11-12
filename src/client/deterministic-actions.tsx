import React from 'react';
import type { Column, Task } from '../shared/types.js';
import type { DeterministicSummary } from '../shared/deterministic.js';
import { useDeterministicEnvironment, useScriptSummary } from './deterministic-context.js';
import { ownedScript } from './deterministic-view.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';
import { PlayIcon } from './icons.js';

/** Independent action state: a slow script never turns the whole board into Saving. */
export function ScriptActions({ task, column, summary, run, compact = false, onReview }: {
  task: Task; column: Column | undefined; summary?: DeterministicSummary; run: RunCommand; compact?: boolean; onReview?: () => void;
}) {
  const action = useAction(run);
  const owned = ownedScript(task, summary);
  if (!owned && !column?.deterministic) return null;
  const stoppable = owned !== undefined && ['capture-pending', 'awaiting-trust', 'active'].includes(owned.phase);
  const stopping = owned?.phase === 'stopping';
  const busy = action.pending || stopping;
  const play = !stoppable && !stopping;
  const className = compact ? 'kb-button kb-card-action' : 'kb-button';
  // A failed saved delivery keeps its result identity; rerunning is a separate
  // action, so its accessible name must match the visible "Run again" label.
  const deliveryFailed = owned?.deliveryStatus === 'failed';
  const label = stoppable ? 'Stop deterministic script' : deliveryFailed ? 'Run again — deterministic script' : 'Play deterministic script';
  const disabled = busy || (play && (!column?.deterministic || Boolean(task.operation || task.pendingTransition)));

  return <div className={compact ? 'kb-script-actions kb-card-run' : 'kb-script-actions'} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" className={className} aria-label={label} title={action.error?.message ?? (play && !column?.deterministic ? 'Configure a deterministic script or change stage before Play.' : label)} aria-busy={busy || undefined} disabled={disabled} onClick={() => void action.execute(stoppable ? { type: 'task.deterministicStop', taskId: task.id, executionId: owned!.executionId } : { type: 'task.deterministicPlay', taskId: task.id })}>
      {busy ? '…' : stoppable ? compact ? <span aria-hidden="true">■</span> : 'Stop' : compact ? <PlayIcon size={15} /> : deliveryFailed ? 'Run again' : 'Play'}
    </button>
    {deliveryFailed && <button type="button" className={className} aria-label="Retry delivery — deterministic result" title={action.error?.message ?? 'Deliver the saved result again without running the script.'} aria-busy={busy || undefined} disabled={busy} onClick={() => void action.execute({ type: 'task.deterministicRetryDelivery', taskId: task.id, entryId: owned!.entryId, executionId: owned!.executionId })}>{compact ? <span aria-hidden="true">↻</span> : 'Retry delivery'}</button>}
    {onReview && <button type="button" className={className} onClick={onReview} aria-label="Review deterministic script and local settings">{compact ? '⋯' : 'Review / local settings'}</button>}
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
