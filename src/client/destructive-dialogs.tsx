import React, { useId, useState } from 'react';
import type { Attention, Command, Problem, Project, Task } from '../shared/types.js';
import { describeOperation } from './operation-description.js';
import { DestructiveConsequences } from './destructive-consequences.js';
import { asProblem, Modal, ProblemNotice, type RunCommand } from './ui.js';

export type DestructiveCommand = Extract<Command, { type: 'task.delete' | 'worktree.remove' }>;

export interface DestructiveRequest {
  command: DestructiveCommand;
  taskId: string;
  title: string;
  path: string | null;
  expectedWorktreePath: string | null;
  branch?: string | null;
  owned?: boolean;
  /** The checkout belongs to a project that no longer has a Git root and must be retained. */
  plainCheckout?: boolean;
  error?: Problem;
}

function DestructiveTaskDialog({ request, task, project, attention, sessionTitles, pending, problem, onCancel, onConfirm, onRetry, onReturn, onForce }: {
  request: DestructiveRequest;
  task: Task;
  project?: Project;
  attention: Attention;
  sessionTitles?: { title(sessionId: string): string | undefined };
  pending: boolean;
  problem: Problem | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry?: () => void;
  onReturn?: () => void;
  onForce?: () => void;
}) {
  const isDelete = request.command.type === 'task.delete';
  const operation = task.operation;
  const description = operation ? describeOperation(task, operation) : null;
  const failed = operation?.phase === 'failed';
  const active = operation !== null && !failed;
  const summaryId = useId();
  const busy = attention.running || attention.background.length > 0;
  const title = isDelete ? 'Delete task' : 'Remove worktree';
  return <Modal title={title} onClose={onCancel} busy={pending} initialFocus="cancel" describedBy={summaryId}>
    <div className="kb-destructive-dialog">
      <div className="kb-destructive-identity"><strong>{request.title}</strong><span className="kb-hint">{project?.name ?? task.projectId}</span></div>
      <div id={summaryId}><DestructiveConsequences request={request} task={task} project={project} busy={busy} /></div>
      {description && !failed && <p className="kb-hint" role="status">{description.detail}</p>}
      {description && failed && <p className="kb-hint">{description.detail}</p>}
      <ProblemNotice problem={problem ?? operation?.error ?? null} title={description?.title ?? (isDelete ? 'Deletion needs attention' : 'Worktree removal needs attention')} sessionTitles={sessionTitles} />
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onCancel}>{operation ? 'Close' : 'Cancel'}</button>
        {active
          ? description?.retry && onRetry
            ? <button type="button" className="kb-button" disabled={pending} onClick={onRetry}>{pending ? 'Working…' : description.retryLabel}</button>
            : <button type="button" className="kb-button" disabled>Working…</button>
          : failed && description?.retry && onRetry
            ? <button type="button" className="kb-button" disabled={pending} onClick={onRetry}>{pending ? 'Working…' : description.retryLabel}</button>
            : !failed && <button type="button" className="kb-button kb-danger" disabled={pending} onClick={onConfirm}>{pending ? (isDelete ? 'Deleting…' : 'Removing…') : (isDelete ? 'Delete task' : 'Remove worktree')}</button>}
        {failed && description?.force && onForce && <button type="button" className="kb-button kb-danger" disabled={pending} onClick={onForce}>Force remove checkout…</button>}
        {failed && description?.return && onReturn && <button type="button" className="kb-button" disabled={pending} onClick={onReturn}>{description.returnLabel}</button>}
      </div>
    </div>
  </Modal>;
}

export function DiscardDialog({ request, run, onClose, onDeleted }: {
  request: DestructiveRequest;
  run: RunCommand;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  return <Modal title="Discard local worktree changes?" onClose={onClose} busy={pending} initialFocus="cancel">
    <div className="kb-destructive-dialog">
      <p className="kb-warning">Additional confirmation required: modified tracked files and untracked files in this worktree can be permanently lost.</p>
      <div className="kb-destructive-identity"><strong>{request.title}</strong>{request.path && <code>{request.path}</code>}{request.branch === 'HEAD' ? <span className="kb-hint">Detached HEAD; no branch is preserved.</span> : request.branch ? <span className="kb-hint">Branch <code>{request.branch}</code> is kept.</span> : null}</div>
      <ProblemNotice problem={error ?? request.error ?? null} title="Local changes require confirmation" />
      <label className="kb-choice"><input type="checkbox" checked={understood} disabled={pending} onChange={event => setUnderstood(event.target.checked)} />I understand that these local changes and untracked files will be discarded.</label>
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onClose}>Keep local changes</button>
        <button type="button" className="kb-button kb-danger" disabled={pending || !understood} onClick={async () => {
          if (!understood) return;
          setPending(true); setError(null);
          try {
            await run({ ...request.command, discardChanges: true });
            if (request.command.type === 'task.delete') onDeleted();
            onClose();
          } catch (failure) { setError(asProblem(failure)); }
          finally { setPending(false); }
        }}>{pending ? 'Removing…' : 'Discard changes and continue'}</button>
      </div>
    </div>
  </Modal>;
}

/** Semantic entry points over the shared destructive dialog implementation. */
export const DeleteTaskDialog = DestructiveTaskDialog;
export const RemoveWorktreeDialog = DestructiveTaskDialog;
