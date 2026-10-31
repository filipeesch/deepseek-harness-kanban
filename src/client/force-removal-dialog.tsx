import React, { useState } from 'react';
import type { Problem } from '../shared/types.js';
import type { SharedWorktreeBlocker } from '../shared/worktree-blockers.js';
import type { DestructiveRequest } from './destructive-dialogs.js';
import { Modal, ProblemNotice } from './ui.js';

/**
 * Explicit consent for removing a checkout that is shared outside the task's
 * lineage. The directory is removed, so the dialog lists every affected task
 * and conversation and requires an opt-in.
 */
export function ForceRemovalDialog({ request, blockers, sessionTitles, pending, problem, onCancel, onConfirm }: {
  request: DestructiveRequest;
  blockers: SharedWorktreeBlocker[];
  sessionTitles?: { title(sessionId: string): string | undefined };
  pending: boolean;
  problem: Problem | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const remove = request.command.type === 'worktree.remove';
  return <Modal title="Force remove shared checkout?" onClose={onCancel} busy={pending} initialFocus="cancel">
    <div className="kb-destructive-dialog">
      <p className="kb-warning">Additional confirmation required: the shared checkout directory will be removed even though another task or DSH conversation is using it.</p>
      <div className="kb-destructive-identity"><strong>{request.title}</strong>{request.path && <code>{request.path}</code>}</div>
      <ul className="kb-consequence-list">
        <li>{remove ? 'The task, its notes, conversations, and branch are kept.' : 'The task card and notes are removed; its conversations are archived and histories remain in DSH.'}</li>
        <li>The checkout directory is deleted. Conversations working there lose that directory and recover to their native header directory when possible.</li>
        <li>Any other task bound to this checkout is marked with a worktree error explaining the forced removal; its effective directory is not changed.</li>
        {!remove && <li>The branch is kept.</li>}
      </ul>
      {blockers.length > 0 && <>
        <p className="kb-hint">Affected by this checkout:</p>
        <ul className="kb-batch-list">{blockers.map(blocker => <li key={blocker.kind + ':' + (blocker.kind === 'task' ? blocker.taskId : blocker.sessionId)}>
          {blocker.kind === 'task'
            ? <><strong>{blocker.title}</strong> — another task{blocker.path ? <> at <code>{blocker.path}</code></> : null}</>
            : <><strong>{sessionTitles?.title(blocker.sessionId) ?? 'Conversation'}</strong> — {blocker.sessionId}</>}
        </li>)}</ul>
      </>}
      <ProblemNotice problem={problem ?? request.error ?? null} title="The shared checkout must be removed explicitly" />
      <label className="kb-choice"><input type="checkbox" checked={understood} disabled={pending} onChange={event => setUnderstood(event.target.checked)} />I understand that the shared checkout directory and its local contents will be removed.</label>
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-button kb-danger" disabled={pending || !understood} onClick={onConfirm}>{pending ? 'Working…' : 'Force remove checkout'}</button>
      </div>
    </div>
  </Modal>;
}
