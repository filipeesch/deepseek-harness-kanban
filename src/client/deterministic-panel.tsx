import React, { useState } from 'react';
import type { ClientApi, Column, Task } from '../shared/types.js';
import { useDeterministicEnvironment, useScriptSummary } from './deterministic-context.js';
import { ownedScript, scriptFailureFacts, scriptLabel } from './deterministic-view.js';
import { ScriptActions } from './deterministic-actions.js';
import { LocalVariablesDialog } from './deterministic-variables.js';
import { useScriptReview } from './script-review-provider.js';
import type { RunCommand } from './ui.js';

/** Outside the selected drawer section, so Stop and approval never disappear with a tab. */
export function ScriptPanel({ task, column, projectName, api, run }: { task: Task; column?: Column; projectName: string; api: ClientApi; run: RunCommand }) {
  const summary = ownedScript(task, useScriptSummary(task.id));
  const environment = useDeterministicEnvironment();
  const openReview = useScriptReview();
  const [variables, setVariables] = useState(false);
  if (!summary && !column?.deterministic) return null;
  const facts = summary === undefined ? [] : scriptFailureFacts(summary);
  const stageId = task.columnId;
  return <div className="kb-script-panel" aria-label="Deterministic execution">
    <div className="kb-script-panel-heading"><strong role="status">{summary ? scriptLabel(summary) : 'Deterministic script — not started'}</strong><ScriptActions task={task} column={column} summary={summary} run={run} /></div>
    <div className="kb-script-panel-tools">
      <button type="button" className="kb-button" aria-label="Review deterministic script" disabled={environment?.boardId === undefined} onClick={() => { if (environment?.boardId !== undefined) void openReview({ boardId: environment.boardId, stageId, taskId: task.id }); }}>Review</button>
      <button type="button" className="kb-button" aria-label="Configure local variables" onClick={() => setVariables(true)}>Local variables</button>
    </div>
    {summary && <p className="kb-hint">Execution {summary.executionId}{summary.fingerprint ? ' · Captured version ' + summary.fingerprint.slice(0, 16) : ''} · Restarted {summary.restartCount} {summary.restartCount === 1 ? 'time' : 'times'}{summary.savedVersionChanged ? ' · Saved changes require Run again' : ''}</p>}
    {summary && !column?.deterministic && <p className="kb-hint">The saved stage is no longer deterministic. This owned entry retains its captured version. Configure a script or change stage before Play.</p>}
    {summary?.deliveryStatus === 'failed' && <p className="kb-hint">This result was saved but its delivery failed. Deliver retries the saved result and its identities; Run again starts a new execution.</p>}
    {summary?.error && <p className="kb-problem" role="alert">{summary.error.message.slice(0, 4096)}</p>}
    {facts.length > 0 && <dl className="kb-script-facts">{facts.map(fact => <React.Fragment key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></React.Fragment>)}</dl>}
    {summary?.error?.code === 'PARAMETERS_REQUIRED' && <p className="kb-hint">Edit this entry's parameters, then press Play.</p>}
    {summary?.parameters && Object.keys(summary.parameters).length > 0 && <p className="kb-hint">Parameters: {Object.entries(summary.parameters).map(([name, value]) => name + '=' + value).join(', ').slice(0, 4096)}</p>}
    {summary?.exit && <p className="kb-hint">Exit {summary.exit}: {summary.message?.slice(0, 4096)}</p>}
    {variables && <LocalVariablesDialog task={task} projectName={projectName} api={api} run={run} onClose={() => setVariables(false)} />}
  </div>;
}
