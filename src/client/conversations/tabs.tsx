import React, { type ReactNode } from 'react';
import type { Attention } from '../../shared/types.js';
import { EMPTY_ATTENTION } from '../../shared/types.js';
import { AttentionDots, AttentionStatusText } from '../attention-dots.js';
import { ConversationCloseAction } from '../conversation-actions.js';
import type { SessionTitles } from '../conversation-label.js';

export interface ConversationTabsProps {
  open: readonly string[];
  active?: string | undefined;
  id: string;
  label: (sessionId: string) => string;
  sessionTitles?: SessionTitles | undefined;
  renaming: { sessionId: string; value: string } | null;
  setRenaming: (value: { sessionId: string; value: string } | null) => void;
  chooseConversation: (sessionId: string) => void;
  beginRename: (sessionId: string) => void;
  commitRename: () => Promise<void>;
  onRequestNew: () => void;
  creating: boolean;
  createBlocked: boolean;
  blockedReason?: string | undefined;
  busy: boolean;
  actionPending: boolean;
  conversationAttention: Readonly<Record<string, Attention>>;
  closedMenu: ReactNode;
}

/** The task's conversation tabs, its closed-conversation menu, and the new-conversation action. */
export function ConversationTabs({ open, active, id, label, sessionTitles, renaming, setRenaming, chooseConversation, beginRename, commitRename, onRequestNew, creating, createBlocked, blockedReason, busy, actionPending, conversationAttention, closedMenu }: ConversationTabsProps) {
  return <div className="kb-session-toolbar"><div className="kb-tabs kb-agent-tabs" role="tablist" aria-label="Agent conversations">{open.map((sessionId, index) => {
    if (renaming?.sessionId === sessionId) return <input key={sessionId} className="kb-input kb-tab-input" autoFocus aria-label={'Rename ' + label(sessionId)} value={renaming.value} onChange={event => setRenaming({ sessionId, value: event.target.value })} onBlur={() => void commitRename()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }} />;
    const attention = conversationAttention[sessionId] ?? EMPTY_ATTENTION;
    return <div key={sessionId} className="kb-tab-item" data-active={active === sessionId ? 'true' : undefined}>
      <button type="button" className="kb-tab" id={id + '-tab-' + sessionId} role="tab" aria-selected={active === sessionId} aria-controls={id + '-conversation'} tabIndex={active === sessionId ? 0 : -1} title={sessionTitles?.title(sessionId) ?? sessionId} onClick={() => chooseConversation(sessionId)} onDoubleClick={() => beginRename(sessionId)} onContextMenu={event => { if (!sessionTitles) return; event.preventDefault(); beginRename(sessionId); }} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % open.length; else if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = open.length - 1; else return; event.preventDefault(); const value = open[next]; if (value) { chooseConversation(value); document.getElementById(id + '-tab-' + value)?.focus(); } }}>{label(sessionId)}<AttentionDots value={attention} decorative /><AttentionStatusText value={attention} /></button>
      {active === sessionId && <ConversationCloseAction />}
    </div>;
  })}</div>
    {closedMenu}
    <button type="button" className="kb-button kb-icon-button" aria-label="New conversation" title={blockedReason ?? 'New conversation'} disabled={actionPending || creating || createBlocked || busy} onClick={onRequestNew}><span aria-hidden="true">+</span></button>
  </div>;
}
