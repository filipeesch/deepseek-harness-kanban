import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Problem } from '../shared/types.js';
import { ConversationNotices } from './conversation-notices.js';
import { ClockIcon, ReopenIcon } from './icons.js';

export interface ClosedConversationsMenuProps {
  closed: readonly string[];
  label: (sessionId: string) => string;
  pending: boolean;
  error: Problem | null;
  /** Called when the popover opens so a stale reopen notice can be cleared. */
  onOpen: () => void;
  onReopen: (sessionId: string) => Promise<boolean>;
  onReopened: (sessionId: string) => void;
}

/**
 * Closed task conversations live behind an on-demand popover so history never
 * competes with the conversation body. The chip is a toolbar sibling, not a tab.
 */
export function ClosedConversationsMenu({ closed, label, pending, error, onOpen, onReopen, onReopened }: ClosedConversationsMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const titleId = id + '-title';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const dismiss = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus && trigger.current?.isConnected) trigger.current.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (pending) return;
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target)) return;
      dismiss(true);
    };
    const key = (event: KeyboardEvent) => {
      if (pending) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Keep the drawer open when only the closed-conversation popover is dismissed.
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, pending, dismiss]);

  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLButtonElement>('button.kb-closed-item:not([aria-disabled=true])')?.focus();
  }, [open]);

  if (closed.length === 0) return null;
  const countLabel = closed.length === 1 ? '1 closed conversation' : closed.length + ' closed conversations';

  function toggle() {
    if (open) { dismiss(true); return; }
    onOpen();
    setOpen(true);
  }

  async function reopen(sessionId: string) {
    if (pending) return;
    const reopened = await onReopen(sessionId);
    if (!reopened || !alive.current) return;
    setOpen(false);
    onReopened(sessionId);
  }

  return <div className="kb-closed-anchor" ref={anchor}>
    <button
      ref={trigger}
      type="button"
      className="kb-closed-chip"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id + '-popover' : undefined}
      aria-label={countLabel}
      title={countLabel}
      disabled={pending}
      onClick={toggle}
    >
      <ClockIcon size={13} />
      <span className="kb-closed-chip-count" aria-hidden="true">{closed.length}</span>
    </button>
    {open && <div ref={popover} id={id + '-popover'} className="kb-closed-popover" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-busy={pending || undefined}>
      <h3 className="kb-closed-title" id={titleId}>Closed conversations</h3>
      <div className="kb-closed-list">
        {closed.map(sessionId => <button
          key={sessionId}
          type="button"
          className="kb-closed-item"
          aria-label={'Reopen ' + label(sessionId)}
          aria-disabled={pending || undefined}
          onClick={() => { if (!pending) void reopen(sessionId); }}
        >
          <span className="kb-closed-item-title">{label(sessionId)}</span>
          <ReopenIcon size={14} className="kb-closed-item-icon" />
        </button>)}
      </div>
      <ConversationNotices notices={[{ key: 'reopen', problem: error }]} />
    </div>}
  </div>;
}
