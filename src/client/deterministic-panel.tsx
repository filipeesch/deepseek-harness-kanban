import React, { useState } from 'react';
import type { ClientApi, Column, Task } from '../shared/types.js';
import { useScriptSummary } from './deterministic-context.js';
import { ownedScript, scriptLabel } from './deterministic-view.js';
import { ScriptActions } from './deterministic-actions.js';
import { ScriptReviewDialog } from './deterministic-review.js';
import type { RunCommand } from './ui.js';

/** Outside the selected drawer section, so Stop and trust never disappear with a tab. */
export function ScriptPanel({ task, column, projectName, api, run }: { task: Task; column?: Column; projectName: string; api: ClientApi; run: RunCommand }) {
  const summary = ownedScript(task, useScriptSummary(task.id));
  const [reviewing, setReviewing] = useState(false);
  if (!summary && !column?.deterministic) return null;
  return <div className="kb-script-panel" aria-label="Deterministic execution">
    <div className="kb-script-panel-heading"><strong role="status">{summary ? scriptLabel(summary) : 'Deterministic script — not started'}</strong><ScriptActions task={task} column={column} summary={summary} run={run} onReview={() => setReviewing(true)} /></div>
    {summary && <p className="kb-hint">Execution {summary.executionId}{summary.fingerprint ? ' · Captured version ' + summary.fingerprint.slice(0, 16) : ''} · Restarted {summary.restartCount} {summary.restartCount === 1 ? 'time' : 'times'}{summary.savedVersionChanged ? ' · Saved changes require Play' : ''}</p>}
    {summary && !column?.deterministic && <p className="kb-hint">The saved stage is no longer deterministic. This owned entry retains its captured version. Configure a script or change stage before Play.</p>}
    {summary?.deliveryStatus === 'failed' && <p className="kb-hint">This result was saved but its delivery failed. Retry delivery keeps the saved result and its identities; Run again starts a new execution.</p>}
    {summary?.error && <p className="kb-problem" role="alert">{summary.error.message.slice(0, 4096)}</p>}
    {summary?.exit && <p className="kb-hint">Exit {summary.exit}: {summary.message?.slice(0, 4096)}</p>}
    {reviewing && <ScriptReviewDialog key={task.id + ':' + task.projectId + ':' + task.stageEntry?.id} task={task} column={column} projectName={projectName} summary={summary} api={api} run={run} onClose={() => setReviewing(false)} />}
  </div>;
}
