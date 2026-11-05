import React from 'react';
import type { Attention, Task } from '../shared/types.js';
import { Modal } from './ui.js';

export function BulkDeleteDialog({ tasks, attention, onCancel, onConfirm }: {
  tasks: Task[];
  attention: Record<string, Attention>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const conversations = tasks.reduce((total, task) => total + task.sessionIds.length, 0);
  const worktrees = tasks.filter(task => task.worktree).length;
  const running = tasks.filter(task => { const value = attention[task.id]; return Boolean(value?.running || (value?.background.length ?? 0) > 0); }).length;
  const unclaimed = tasks.reduce((total, task) => total + (task.unclaimedWorktrees?.length ?? 0), 0);
  return <Modal title="Delete selected tasks" onClose={onCancel} initialFocus="cancel">
    <div className="kb-destructive-dialog">
      <p>Delete {tasks.length} selected task{tasks.length === 1 ? '' : 's'}?</p>
      <ul className="kb-consequence-list">
        <li>{conversations} conversation{conversations === 1 ? '' : 's'} will be archived; their histories remain in DSH.</li>
        <li>{worktrees} worktree{worktrees === 1 ? '' : 's'} will be removed; branches are kept.</li>
        {unclaimed > 0 && <li>{unclaimed} unclaimed checkout{unclaimed === 1 ? '' : 's'} remain on disk.</li>}
        {running > 0 && <li>{running} selected task{running === 1 ? ' has' : 's have'} a running turn or unsettled background work; their deletion waits until they settle.</li>}
        <li>Deletion is queued in the background and the board stays usable. A task that cannot be started is reported on the board, and a later failure appears in the destructive-operation notice.</li>
      </ul>
      <ul className="kb-batch-list">{tasks.map(task => <li key={task.id}><strong>{task.title}</strong>{task.worktree ? <> — <code>{task.worktree.path}</code></> : null}</li>)}</ul>
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-button kb-danger" disabled={tasks.length === 0} onClick={onConfirm}>Delete selected</button>
      </div>
    </div>
  </Modal>;
}
