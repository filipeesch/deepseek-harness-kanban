import React, { useRef } from 'react';

function AttachmentGlyph() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 5.2 5.9 9.9a2 2 0 0 0 2.8 2.8l4.7-4.7a3.6 3.6 0 0 0-5.1-5.1L3.6 7.6a5.2 5.2 0 0 0 7.3 7.3l3.5-3.5" /></svg>;
}

/**
 * One compact attachment action: an icon that opens the browser file dialog.
 *
 * The hidden input keeps a ": choose a file" suffix on its accessible name, so a
 * test or assistive technology can address the picker apart from the icon.
 */
export function AttachButton({ label, disabled = false, onPick, buttonRef, className = 'ka-icon-button' }: {
  /** Accessible name of the action, such as "Attach files to this question". */
  label: string;
  disabled?: boolean;
  /** Receives the picked files in source order. */
  onPick: (files: readonly File[]) => void;
  /** The action itself, so a surface can return focus to it after a recovery notice closes. */
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} type="file" multiple hidden aria-label={label + ': choose a file'} onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length > 0) onPick(files);
    }} />
    <button ref={buttonRef} type="button" className={className} disabled={disabled} aria-label={label} title={label} onClick={() => input.current?.click()}>
      <AttachmentGlyph />
    </button>
  </>;
}
