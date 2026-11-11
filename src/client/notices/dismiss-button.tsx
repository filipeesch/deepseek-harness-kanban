import React from 'react';
import { CloseIcon } from '../icons.js';

/**
 * The board's one dismiss affordance: a compact icon-only control at the notice's
 * trailing edge. The accessible name identifies the notice it removes, so an
 * assistive-technology user hears which notice a control belongs to.
 */
export function DismissButton({ label, hint, onDismiss }: {
  label: string;
  hint: string;
  /** Receives the control so the caller can hand focus to the next notice. */
  onDismiss: (control: HTMLButtonElement) => void;
}) {
  return <button
    type="button"
    className="kb-dismiss-button"
    data-kb-dismiss=""
    aria-label={label}
    title={hint}
    onClick={event => onDismiss(event.currentTarget)}
  ><CloseIcon size={14} /></button>;
}
