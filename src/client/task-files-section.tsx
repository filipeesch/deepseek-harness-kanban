import React, { useEffect, useId, useRef, useState } from 'react';
import type { Problem, Task, TaskAttachment } from '../shared/types.js';
import { ErrorNotice } from './ui.js';
import { TaskFilesPanel, attachmentDownloadUrl } from './task-files.js';
import { readFilesBase64 } from '../attachments/bytes.js';
import { AttachButton } from '../attachments/AttachButton.js';
import { AttachmentFailureNotice } from '../attachments/AttachmentFailureNotice.js';
import { useAttachmentPicks } from '../attachments/picks.js';
import { clipboardFiles } from '../attachments/clipboard.js';
import { useRestoreFocusAfterFailure } from '../attachments/focus.js';
import type { RunCommand } from './ui.js';

/** The attachments of one task, presented inside the drawer's Info section. */
export function TaskFilesSection({ task, hubId, run }: {
  task: Task;
  /** The Hub holding the task, so the download route can resolve it directly. */
  hubId?: string;
  run: RunCommand;
}) {
  const [busy, setBusy] = useState(false);
  /** A removal or download failure; an add failure belongs to the pick's own notice. */
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<TaskAttachment | null>(null);
  useEffect(() => { if (pendingRemoval !== null) keepFileRef.current?.focus(); }, [pendingRemoval]);
  // The safe choice takes focus, so an accidental Enter cannot delete a file.
  const keepFileRef = useRef<HTMLButtonElement>(null);
  /** The Remove control that opened the dialog, so cancelling can return focus to it. */
  const removalTrigger = useRef<HTMLElement | null>(null);
  /**
   * Close the confirmation and return focus to the control that opened it. A focused
   * control that unmounts would otherwise drop focus to the document body.
   */
  function cancelRemoval(): void {
    setPendingRemoval(null);
    removalTrigger.current?.focus();
    removalTrigger.current = null;
  }
  const removalWarningId = useId();
  const picks = useAttachmentPicks();
  const attachRef = useRef<HTMLButtonElement>(null);
  const attachmentFailure = picks.failure === undefined ? '' : toProblem(picks.failure).message;
  // A selection still reading, or one that failed until it is retried or discarded, keeps
  // the add action unavailable: the surface recovers before it takes more files.
  const attachBlocked = busy || picks.pending > 0 || picks.failed > 0;
  useRestoreFocusAfterFailure(picks.failed, !attachBlocked, attachRef);

  /**
   * Add one picked batch to the task. The command publishes the updated board, so the
   * list re-renders from the snapshot rather than from local state.
   */
  function acceptPick(origin: 'upload' | 'clipboard'): (files: readonly File[]) => Promise<void> {
    return async picked => {
      const reads = await readFilesBase64(picked);
      await add({ attachmentUploads: reads.map(read => ({ name: read.file.name, origin, data: read.data })) });
    };
  }
  async function add(command: { attachmentUploads: Array<{ name: string; origin: 'upload' | 'clipboard'; data: string }> }): Promise<void> {
    setBusy(true); setProblem(null);
    try { await run({ type: 'task.edit', taskId: task.id, ...command }); }
    finally { setBusy(false); }
  }
  async function remove(attachment: TaskAttachment): Promise<void> {
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      await run({ type: 'task.edit', taskId: task.id, removeAttachmentIds: [attachment.id], confirmed: true });
      setPendingRemoval(null);
    } catch (failure) { setProblem(toProblem(failure)); }
    finally { setBusy(false); }
  }
  /**
   * Hand the download to the browser. The route answers with a disposition header, so
   * the browser saves the bytes under the recorded name without buffering them here.
   */
  function download(attachment: TaskAttachment): void {
    setProblem(null);
    const anchor = document.createElement('a');
    anchor.href = attachmentDownloadUrl({ taskId: task.id, attachmentId: attachment.id, ...(hubId === undefined ? {} : { hubId }) });
    anchor.download = attachment.name;
    anchor.rel = 'noopener';
    anchor.click();
  }

  // One named region only: the inner panel carries the accessible name, so the
  // wrapper stays an unnamed layout container.
  return <div className="kb-form kb-task-files-section" onPaste={event => {
    // A pasted file is an attachment; pasted text stays text. A blocked surface takes no
    // new file from the clipboard either.
    const files = clipboardFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    if (attachBlocked) return;
    picks.pick(files, acceptPick('clipboard'));
  }}>
    <TaskFilesPanel task={task} busy={busy} problem={problem} onDownloadRequest={attachment => { void download(attachment); }} onRemoveRequest={attachment => { removalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPendingRemoval(attachment); }} />
    <div className="ka-attachment-bar" role="group" aria-label="Files for this task">
      <AttachButton label="Attach files" buttonRef={attachRef} disabled={attachBlocked} onPick={files => picks.pick(files, acceptPick('upload'))} />
    </div>
    <AttachmentFailureNotice failed={picks.failed} message={attachmentFailure} disabled={busy} onRetry={picks.retryFailed} onDiscard={picks.discardFailed} />
    {pendingRemoval !== null && <div
      className="kb-inline-confirm"
      role="alertdialog"
      aria-label="Confirm file removal"
      aria-describedby={removalWarningId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRemoval(); } }}
    >
      <p id={removalWarningId}>Removing <strong>{pendingRemoval.name}</strong> deletes its stored bytes. This cannot be undone.</p>
      <div className="kb-actions">
        <button ref={keepFileRef} type="button" className="kb-button" disabled={busy} onClick={() => cancelRemoval()}>Keep the file</button>
        <button type="button" className="kb-button kb-danger" disabled={busy} onClick={() => { void remove(pendingRemoval); }}>Remove file</button>
      </div>
    </div>}
  </div>;
}

/** Read one failure into the problem shape the notices render. */
export function toProblem(failure: unknown): Problem {
  if (failure !== null && typeof failure === 'object' && 'code' in failure && 'message' in failure) {
    return { code: String((failure as { code: unknown }).code), message: String((failure as { message: unknown }).message) };
  }
  return { code: 'UNKNOWN', message: failure instanceof Error ? failure.message : String(failure) };
}
