import React from 'react';
import type { Attention, Task } from '../shared/types.js';
import { Modal } from './ui.js';

export interface BulkDeletionResult {
  queued: number;
  skipped: Array<{ title: string; message: string }>;
}

export interface BulkProgress {
  current: number;
  total: number;
  title: string;
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
  const running = tasks.filter(task => { const value = attention[task.id]; return Boolean(value?.running || (value?.background.length ?? 0) > 0); }).length;
  const unclaimed = tasks.reduce((total, task) => total + (task.unclaimedWorktrees?.length ?? 0), 0);
  return <Modal title="Delete selected tasks" onClose={onCancel} busy={pending} initialFocus="cancel">
    <div className="kb-destructive-dialog">
      <p>Delete {tasks.length} selected task{tasks.length === 1 ? '' : 's'}?</p>
      <ul className="kb-consequence-list">
        <li>{conversations} conversation{conversations === 1 ? '' : 's'} will be archived; their histories remain in DSH.</li>
        <li>{worktrees} worktree{worktrees === 1 ? '' : 's'} will be removed; branches are kept.</li>
        {unclaimed > 0 && <li>{unclaimed} unclaimed checkout{unclaimed === 1 ? '' : 's'} remain on disk.</li>}
        {running > 0 && <li>{running} selected task{running === 1 ? ' has' : 's have'} a running turn or unsettled background work and will be skipped.</li>}
        <li>Eligible tasks are queued and deleted in the background; the board stays usable. Tasks with a running turn or unsettled background work, an unresolved operation, or local worktree changes are skipped and reported.</li>
      </ul>
      <ul className="kb-batch-list">{tasks.map(task => <li key={task.id}><strong>{task.title}</strong>{task.worktree ? <> — <code>{task.worktree.path}</code></> : null}</li>)}</ul>
      {progress && <p className="kb-hint" role="status">Queueing {progress.current} of {progress.total}: {progress.title}</p>}
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-button kb-danger" disabled={pending || tasks.length === 0} onClick={onConfirm}>{pending ? 'Queueing…' : 'Delete selected'}</button>
      </div>
    </div>
  </Modal>;
}

export function BulkResultDialog({ result, onClose }: { result: BulkDeletionResult; onClose: () => void }) {
  return <Modal title="Deletion results" onClose={onClose}>
    <div className="kb-destructive-dialog">
      <p>{result.queued} task{result.queued === 1 ? '' : 's'} queued for deletion.</p>
      <p className="kb-hint">The board notice tracks each queued task until it completes or fails.</p>
      {result.skipped.length > 0 && <>
        <p className="kb-warning">Skipped:</p>
        <ul className="kb-batch-list">{result.skipped.map((item, index) => <li key={index}><strong>{item.title}</strong> — {item.message}</li>)}</ul>
        <p>The skipped tasks remain selected so you can retry after resolving them.</p>
      </>}
      <div className="kb-actions"><button type="button" className="kb-button" onClick={onClose}>Close</button></div>
    </div>
  </Modal>;
}
