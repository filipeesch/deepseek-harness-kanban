import React from 'react';
import { attachmentSize } from './bytes.js';

/** The smallest attachment record a compact token needs. */
export interface AttachmentToken {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
}

/**
 * Attached files as compact tokens: display name, byte length, and removal.
 *
 * A token is deliberately smaller than a file row: the surfaces that use it already
 * carry the file's placement in their own footer, so only the identity and the size
 * are worth spending on.
 */
export function AttachmentChips({ attachments, disabled = false, onRemove, focusFallback, className = 'ka-chips' }: {
  attachments: readonly AttachmentToken[];
  disabled?: boolean;
  onRemove: (attachmentId: string) => void;
  /** Where focus goes when the removed token was the last one: the surface's add action. */
  focusFallback?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return <ul className={className}>
    {attachments.map(attachment => <li key={attachment.id} className="ka-chip">
      <span className="ka-chip-name" title={attachment.name}>{attachment.name}</span>
      <span className="ka-chip-size">{attachmentSize(attachment.bytes)}</span>
      <button type="button" className="ka-chip-remove" disabled={disabled} aria-label={'Remove ' + attachment.name} title={'Remove ' + attachment.name} onClick={event => {
        // The token that was just removed unmounts, so focus moves to a control that
        // stays: the next token, the previous one, or the surface's add action.
        const item = event.currentTarget.closest('li');
        const items = item?.parentElement === null || item?.parentElement === undefined ? [] : Array.from(item.parentElement.querySelectorAll('li'));
        const index = item === null ? -1 : items.indexOf(item);
        const neighbour = items[index + 1] ?? items[index - 1];
        const target = neighbour?.querySelector<HTMLElement>('button') ?? focusFallback?.current ?? undefined;
        onRemove(attachment.id);
        target?.focus();
      }}>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </li>)}
  </ul>;
}
