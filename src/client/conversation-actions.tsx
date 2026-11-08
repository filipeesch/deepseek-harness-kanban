import React, { createContext, useContext, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';

/** The active root conversation owned by the drawer's Conversations section. */
export interface ConversationActions {
  activeSessionId: string | null;
  pending: boolean;
  close(): void;
  label(sessionId: string): string;
}

const noActions: ConversationActions = {
  activeSessionId: null,
  pending: false,
  close: () => {},
  label: () => '',
};

const ConversationActionsContext = createContext<ConversationActions>(noActions);

export function ConversationActionsProvider({ value, children }: { value: ConversationActions; children: ReactNode }) {
  return <ConversationActionsContext.Provider value={value}>{children}</ConversationActionsContext.Provider>;
}

export function useConversationActions(): ConversationActions {
  return useContext(ConversationActionsContext);
}

/**
 * The drawer's close action consumes the active conversation through context
 * and renders inside that conversation's tab. It renders nothing when no
 * active conversation exists.
 */
export function ConversationCloseAction() {
  const actions = useConversationActions();
  const sessionId = actions.activeSessionId;
  if (sessionId === null) return null;
  const label = 'Close ' + actions.label(sessionId);
  return <button type="button" className="kb-button kb-icon-button kb-session-close" aria-label={label} title={label} disabled={actions.pending} onClick={() => actions.close()}>
    <CloseIcon size={14} />
  </button>;
}
