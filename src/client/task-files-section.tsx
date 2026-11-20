import React, { useEffect, useId, useRef, useState } from 'react';
import type { ClientApi, Problem, Task, TaskAttachment } from '../shared/types.js';
import { ErrorNotice } from './ui.js';
import { TaskFilesPanel, attachmentDownloadUrl, readFileBase64 } from './task-files.js';
import type { RunCommand } from './ui.js';

/** The attachments of one task, presented inside the drawer's Info section. */
export function TaskFilesSection({ task, api, hubId, run }: {
  task: Task;
  api: ClientApi | undefined;
  /** The Hub holding the task, so the download route can resolve it directly. */
  hubId?: string;
  run: RunCommand;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<TaskAttachment | null>(null);
  useEffect(() => { if (pendingRemoval !== null) keepFileRef.current?.focus(); }, [pendingRemoval]);
  const pathInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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

  async function addPaths(): Promise<void> {
    const value = pathInput.current?.value.trim() ?? '';
    if (value === '' || busy) return;
    await add({ attachmentPaths: [value] });
    if (pathInput.current !== null) pathInput.current.value = '';
  }
  async function addFiles(files: readonly File[], origin: 'upload' | 'clipboard'): Promise<void> {
    if (files.length === 0 || busy) return;
    try {
      const uploads = await Promise.all(files.map(async file => ({
        name: file.name,
        origin,
        data: await readFileBase64(file),
      })));
      await add({ attachmentUploads: uploads });
    } catch (failure) { setProblem(toProblem(failure)); }
  }
  async function add(command: { attachmentPaths?: string[]; attachmentUploads?: Array<{ name: string; origin: 'upload' | 'clipboard'; data: string }> }): Promise<void> {
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      // The command publishes the updated board, so the list re-renders from the
      // snapshot rather than from local state.
      await run({ type: 'task.edit', taskId: task.id, ...command });
    } catch (failure) { setProblem(toProblem(failure)); }
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
  return <div className="kb-form kb-task-files-section">
    <TaskFilesPanel task={task} api={api} busy={busy} problem={problem} onDownloadRequest={attachment => { void download(attachment); }} onRemoveRequest={attachment => { removalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPendingRemoval(attachment); }} />
    <div className="kb-file-add">
      <label className="kb-field">Attach a file by host path
        <div className="kb-input-row">
          <input ref={pathInput} className="kb-input" placeholder="/absolute/path/to/file" disabled={busy} aria-label="Attachment host path" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addPaths(); } }} onPaste={event => {
            // A pasted file is an attachment; pasted text stays text.
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            void addFiles(files, 'clipboard');
          }} />
          <button type="button" className="kb-button" disabled={busy} onClick={() => { void addPaths(); }}>Add</button>
        </div>
      </label>
      <div className="kb-file-add-actions">
        <input ref={fileInput} type="file" hidden aria-label="Attach a file" onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void addFiles(files, 'upload');
        }} />
        <button type="button" className="kb-button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose a file</button>
        <span className="kb-hint">Or paste a file from the clipboard into the path field.</span>
      </div>
    </div>
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
