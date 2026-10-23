import React, { useId, useState } from 'react';
import type { Attention, Command, Problem, Project, Task } from '../shared/types.js';
import { describeOperation } from './operation-description.js';
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
  error?: Problem;
}

export interface BulkDeletionResult {
  deleted: number;
  skipped: Array<{ title: string; message: string }>;
}

export interface BulkProgress {
  current: number;
  total: number;
  title: string;
}

export function DeleteTaskDialog({ request, task, project, attention, sessionTitles, pending, problem, onCancel, onConfirm, onRetry, onReturn }: {
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
}) {
  const isDelete = request.command.type === 'task.delete';
  const operation = task.operation;
  const description = operation ? describeOperation(task, operation) : null;
  const failed = operation?.phase === 'failed';
  const active = operation !== null && !failed;
  const summaryId = useId();
  const conversations = task.sessionIds.length;
  const closed = task.closedSessionIds.length;
  const unclaimed = task.unclaimedWorktrees ?? [];
  const detached = request.branch === 'HEAD';
  const title = isDelete ? 'Delete task' : 'Remove worktree';
  return <Modal title={title} onClose={onCancel} busy={pending} initialFocus="cancel" describedBy={summaryId}>
    <div className="kb-destructive-dialog">
      <div className="kb-destructive-identity"><strong>{request.title}</strong><span className="kb-hint">{project?.name ?? task.projectId}</span></div>
      <ul className="kb-consequence-list" id={summaryId}>
        {isDelete ? <>
          <li>Card and notes are deleted. This cannot be undone.</li>
          <li>{conversations} conversation{conversations === 1 ? '' : 's'}{closed > 0 ? ' (' + closed + ' closed)' : ''} will be archived; their histories remain in DSH.</li>
        </> : <>
          <li>The task, its notes, conversations, histories, and Git branch are kept.</li>
          <li>All conversations return to the project before worktree cleanup.</li>
        </>}
        {request.path
          ? <li>The checkout at <code>{request.path}</code>{request.branch ? <> on branch <code>{request.branch}</code></> : null} will be removed{request.owned === false ? ' (it was attached externally)' : request.owned === true ? ' (created by Kanban)' : ''}. {isDelete ? (detached ? 'The checkout is detached; Git has no branch to preserve.' : 'The branch is kept.') : ''}</li>
          : isDelete && <li>No worktree is associated, so the project folder is not removed.</li>}
        {unclaimed.length > 0 && <li><span className="kb-warning" role="note" aria-label="Unclaimed checkout deletion warning">Unclaimed checkouts remain on disk. They are not included in this deletion and require manual inspection.</span><ul className="kb-unclaimed-list">{unclaimed.map(entry => <li key={entry.path}><code>{entry.path}</code>{entry.branch ? <> on <code>{entry.branch}</code></> : null}</li>)}</ul></li>}
        {attention.running && <li>A conversation is running. Deletion waits until every conversation is idle.</li>}
        {request.path && <li>If the worktree has local changes, a separate discard confirmation appears before removal.</li>}
      </ul>
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

export function BulkDeleteDialog({ tasks, attention, pending, progress, onCancel, onConfirm }: {
  tasks: Task[];
  attention: Record<string, Attention>;
  pending: boolean;
  progress?: BulkProgress | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const conversations = tasks.reduce((total, task) => total + task.sessionIds.length, 0);
  const worktrees = tasks.filter(task => task.worktree).length;
  const running = tasks.filter(task => attention[task.id]?.running).length;
  const unclaimed = tasks.reduce((total, task) => total + (task.unclaimedWorktrees?.length ?? 0), 0);
  return <Modal title="Delete selected tasks" onClose={onCancel} busy={pending} initialFocus="cancel">
    <div className="kb-destructive-dialog">
      <p>Delete {tasks.length} selected task{tasks.length === 1 ? '' : 's'}?</p>
      <ul className="kb-consequence-list">
        <li>{conversations} conversation{conversations === 1 ? '' : 's'} will be archived; their histories remain in DSH.</li>
        <li>{worktrees} worktree{worktrees === 1 ? '' : 's'} will be removed; branches are kept.</li>
        {unclaimed > 0 && <li>{unclaimed} unclaimed checkout{unclaimed === 1 ? '' : 's'} remain on disk.</li>}
        {running > 0 && <li>{running} selected task{running === 1 ? ' has' : 's have'} a running conversation and will be skipped.</li>}
        <li>Tasks with running chats, an unresolved operation, or local worktree changes are skipped and reported.</li>
      </ul>
      <ul className="kb-batch-list">{tasks.map(task => <li key={task.id}><strong>{task.title}</strong>{task.worktree ? <> — <code>{task.worktree.path}</code></> : null}</li>)}</ul>
      {progress && <p className="kb-hint" role="status">Deleting {progress.current} of {progress.total}: {progress.title}</p>}
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-button kb-danger" disabled={pending || tasks.length === 0} onClick={onConfirm}>{pending ? 'Deleting…' : 'Delete selected'}</button>
      </div>
    </div>
  </Modal>;
}

export function BulkResultDialog({ result, onClose }: { result: BulkDeletionResult; onClose: () => void }) {
  return <Modal title="Deletion results" onClose={onClose}>
    <div className="kb-destructive-dialog">
      <p>{result.deleted} task{result.deleted === 1 ? '' : 's'} deleted.</p>
      {result.skipped.length > 0 && <>
        <p className="kb-warning">Skipped:</p>
        <ul className="kb-batch-list">{result.skipped.map((item, index) => <li key={index}><strong>{item.title}</strong> — {item.message}</li>)}</ul>
        <p>The skipped tasks remain selected so you can retry after resolving them.</p>
      </>}
      <div className="kb-actions"><button type="button" className="kb-button" onClick={onClose}>Close</button></div>
    </div>
  </Modal>;
}
