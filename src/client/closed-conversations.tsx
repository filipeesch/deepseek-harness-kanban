import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem } from '../shared/types.js';
import { ConversationNotices } from './conversation-notices.js';
import { ClockIcon, ReopenIcon } from './icons.js';
import { Popover, type PopoverHandle } from './popover.js';

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
  const popover = useRef<PopoverHandle>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  if (closed.length === 0) return null;
  const countLabel = closed.length === 1 ? '1 closed conversation' : closed.length + ' closed conversations';

  async function reopen(sessionId: string) {
    if (pending) return;
    const reopened = await onReopen(sessionId);
    if (!reopened || !alive.current) return;
    popover.current?.close();
    onReopened(sessionId);
  }

  return <Popover
    ref={popover}
    label="Closed conversations"
    trigger={<><ClockIcon size={13} /><span className="kb-closed-chip-count" aria-hidden="true">{closed.length}</span></>}
    triggerClassName="kb-closed-chip"
    triggerLabel={countLabel}
    triggerDisabled={pending}
    dismissable={!pending}
    busy={pending}
    anchorClassName="kb-closed-anchor"
    popoverClassName="kb-closed-popover"
    initialFocusSelector="button.kb-closed-item:not([aria-disabled=true])"
    onOpen={onOpen}
  >
    <h3 className="kb-closed-title">Closed conversations</h3>
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
  </Popover>;
}
