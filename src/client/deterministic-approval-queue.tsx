import React from 'react';
import type { DeterministicSummary } from '../shared/deterministic.js';
import type { Task, Workflow } from '../shared/types.js';
import { ownedScript, scriptAwaitingApproval } from './deterministic-view.js';
import { useScriptReview } from './script-review-provider.js';

interface WaitingVersion { key: string; stageId: string; stageIdentity: string; fingerprint: string; name: string; taskIds: string[]; projectIds: Set<string> }

/**
 * One item per unapproved stage version, not per card or per stage: two versions
 * of the same stage are two reviews, and approving once starts every card waiting
 * for that version. The queue is derived from the snapshot the cards already use
 * and is never dismissible while work is pending.
 */
export function ApprovalQueue({ boardId, tasks, scripts, workflow, projectNames }: {
  boardId: string | undefined;
  tasks: readonly Task[];
  scripts: Readonly<Record<string, DeterministicSummary>>;
  workflow: Workflow | undefined;
  projectNames?: ReadonlyMap<string, string>;
}) {
  const openReview = useScriptReview();
  if (boardId === undefined || workflow === undefined) return null;
  const groups = new Map<string, WaitingVersion>();
  for (const task of tasks) {
    const script = ownedScript(task, scripts[task.id]);
    if (!scriptAwaitingApproval(script) || task.stageEntry === undefined) continue;
    const key = task.stageEntry.stageIdentity + ':' + (script!.fingerprint ?? '');
    const existing = groups.get(key);
    const name = workflow.columns.find(column => column.id === task.columnId)?.name ?? task.columnId;
    if (existing === undefined) groups.set(key, { key, stageId: task.columnId, stageIdentity: task.stageEntry.stageIdentity, fingerprint: script!.fingerprint ?? '', name, taskIds: [task.id], projectIds: new Set([task.projectId]) });
    else { existing.taskIds.push(task.id); existing.projectIds.add(task.projectId); }
  }
  const order = new Map(workflow.columns.map((column, index) => [column.id, index]));
  const waiting = [...groups.values()].sort((left, right) => (order.get(left.stageId) ?? 0) - (order.get(right.stageId) ?? 0) || left.key.localeCompare(right.key));
  if (waiting.length === 0) return null;
  const versionsPerStage = new Map<string, number>();
  for (const item of waiting) versionsPerStage.set(item.stageId, (versionsPerStage.get(item.stageId) ?? 0) + 1);
  return <div className="kb-approval-queue" role="status" aria-label="Script approvals">
    <strong className="kb-approval-title">Script approvals</strong>
    {waiting.map(item => {
      const projects = item.projectIds.size > 1 ? [...item.projectIds].map(id => projectNames?.get(id) ?? id).join(', ') : undefined;
      return <div key={item.key} className="kb-approval-item">
        <span>{item.name}{versionsPerStage.get(item.stageId) === 1 ? '' : ' · v' + item.fingerprint.slice(0, 10)}: {item.taskIds.length} {item.taskIds.length === 1 ? 'card waiting' : 'cards waiting'}{projects === undefined ? '' : ' · ' + projects}</span>
        <button type="button" className="kb-button kb-primary" onClick={() => { void openReview({ boardId, stageId: item.stageId, taskId: item.taskIds[0] }); }}>Review and approve</button>
      </div>;
    })}
  </div>;
}
