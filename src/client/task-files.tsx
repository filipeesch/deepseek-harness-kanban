import React from 'react';
import type { Problem, Task, TaskAttachment } from '../shared/types.js';
import { TASK_ATTACHMENT_ROUTE } from '../host/task-attachments/route.js';
import { attachmentSize } from '../attachments/bytes.js';
import { ErrorNotice } from './ui.js';

/**
 * The files of one task: every stored attachment with its size, plus download
 * and removal. Adding and removing are the caller's commands; this surface only
 * presents and asks.
 */
export function TaskFilesPanel({ task, busy, problem, onDownloadRequest, onRemoveRequest }: {
  task: Task;
  busy: boolean;
  problem: Problem | null;
  onDownloadRequest: (attachment: TaskAttachment) => void;
  onRemoveRequest: (attachment: TaskAttachment) => void;
}) {
  const attachments = task.attachments ?? [];
  // The authenticated route serves the bytes, so a host that wired the attachment store
  // always downloads; the read RPC is only what a restored draft uses.
  return <section className="kb-form kb-task-files" aria-label="Task files">
    <h3>Files</h3>
    {attachments.length === 0
      ? <p className="kb-hint">This task has no files.</p>
      : <ul className="kb-file-list">
        {attachments.map(attachment => <li key={attachment.id}>
          <span className="kb-file-name" title={attachment.name}>{attachment.name}</span>
          <span className="kb-file-size">{attachmentSize(attachment.bytes)}</span>
          <button type="button" className="kb-button" disabled={busy} aria-label={"Download " + attachment.name} onClick={() => onDownloadRequest(attachment)}>Download</button>
          <button type="button" className="kb-button" aria-label={"Remove " + attachment.name} disabled={busy} onClick={() => onRemoveRequest(attachment)}>Remove</button>
        </li>)}
      </ul>}
    <ErrorNotice problem={problem} />
  </section>;
}

/**
 * The authenticated address of one stored attachment. The route answers with the
 * bytes and a disposition header, so the browser downloads them natively instead of
 * buffering a base64 payload in memory.
 *
 * @param request - the task and attachment to fetch, plus the Hub when known.
 * @returns the absolute path below the shared API channel.
 */
export function attachmentDownloadUrl(request: { taskId: string; attachmentId: string; hubId?: string }): string {
  const query = new URLSearchParams({ taskId: request.taskId, attachmentId: request.attachmentId });
  if (request.hubId !== undefined) query.set('hubId', request.hubId);
  return TASK_ATTACHMENT_ROUTE + '?' + query.toString();
}
