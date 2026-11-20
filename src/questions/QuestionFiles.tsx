import React, { useRef } from 'react';
import type { QuestionAttachment } from '../shared/types.js';

/** Human-readable size for one answer attachment. */
function sizeText(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * The files attached to one question slide or to the round. The control offers the
 * browser file dialog; a clipboard paste is routed by the slide that owns it.
 */
export function QuestionFiles({
  attachments, disabled, label, onPick, onRemove, failures = 0, onRetryFailed, onDiscardFailed,
}: {
  attachments: readonly QuestionAttachment[];
  disabled: boolean;
  /** How many selections failed and still block the answer. */
  failures?: number;
  /** Retry the failed selections with the same files. */
  onRetryFailed?: () => void;
  /** Drop the failed selections so the answer can proceed without them. */
  onDiscardFailed?: () => void;
  /** Accessible name for this attachment control. */
  label: string;
  /** Receives the browser files the user picked, in source order. */
  onPick: (files: readonly File[]) => void;
  onRemove: (attachmentId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // A named group, so assistive technology announces which slide the files belong to
  // and a test can address one control without matching its hidden file input.
  return <div className="kq-files" role="group" aria-label={label}>
    <div className="kq-files-actions">
      <input ref={input} type="file" multiple hidden aria-label={label + ": choose a file"} onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length > 0) onPick(files);
      }} />
      <button type="button" className="kq-secondary" disabled={disabled} onClick={() => input.current?.click()}>Attach file</button>
      <span className="kq-step">Or paste a file from the clipboard.</span>
    </div>
    {failures > 0 && <div className="kq-file-failures" role="alert">
      <p>{failures === 1 ? 'A selected file could not be attached.' : failures + ' selected files could not be attached.'}</p>
      {/* The person can always recover: retrying attaches again, discarding drops the
          failed selection so an answer is never blocked with no way forward. */}
      <button type="button" className="kq-secondary" disabled={disabled} onClick={onRetryFailed}>Try again</button>
      <button type="button" className="kq-secondary" disabled={disabled} onClick={onDiscardFailed}>Discard failed files</button>
    </div>}
    {attachments.length > 0 && <ul className="kq-file-list">
      {attachments.map(attachment => <li key={attachment.id}>
        <span className="kq-file-name" title={attachment.name}>{attachment.name}</span>
        <span className="kq-file-size">{sizeText(attachment.bytes)}</span>
        <button type="button" className="kq-file-remove" disabled={disabled} aria-label={"Remove " + attachment.name} onClick={() => onRemove(attachment.id)}>Remove</button>
      </li>)}
    </ul>}
  </div>;
}

/**
 * The clipboard files carried by one paste event. A text paste returns an empty
 * list, so a pasted sentence never becomes an attachment.
 */
export function clipboardFiles(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files ?? []);
}
