import React from 'react';
import type { ClientApi, Problem, Task, TaskAttachment } from '../shared/types.js';
import { TASK_ATTACHMENT_ROUTE } from '../host/task-attachments/route.js';
import { ErrorNotice } from './ui.js';

/** One attachment source the surface can add from. */
export type TaskFileSource = 'path' | 'upload' | 'clipboard';

/** Human-readable size for one attachment. */
export function attachmentSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Read one browser file as canonical base64 for the add command. */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const separator = url.indexOf(',');
      if (separator < 0) { reject(new Error('The selected file could not be read.')); return; }
      resolve(url.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * The files of one task: every stored attachment with its size, plus download
 * and removal. Adding and removing are the caller's commands; this surface only
 * presents and asks.
 */
export function TaskFilesPanel({ task, api, busy, problem, onDownloadRequest, onRemoveRequest }: {
  task: Task;
  api: ClientApi | undefined;
  busy: boolean;
  problem: Problem | null;
  onDownloadRequest: (attachment: TaskAttachment) => void;
  onRemoveRequest: (attachment: TaskAttachment) => void;
}) {
  const attachments = task.attachments ?? [];
  // The authenticated route serves the bytes, so a host that wired the attachment store
  // always downloads; the read RPC is only what a restored draft uses.
  const canDownload = true;
  return <section className="kb-form kb-task-files" aria-label="Task files">
    <h3>Files</h3>
    {attachments.length === 0
      ? <p className="kb-hint">This task has no files.</p>
      : <ul className="kb-file-list">
        {attachments.map(attachment => <li key={attachment.id}>
          <span className="kb-file-name" title={attachment.name}>{attachment.name}</span>
          <span className="kb-file-size">{attachmentSize(attachment.bytes)}</span>
          <button type="button" className="kb-button" disabled={busy || !canDownload} aria-label={"Download " + attachment.name} onClick={() => onDownloadRequest(attachment)}>Download</button>
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
