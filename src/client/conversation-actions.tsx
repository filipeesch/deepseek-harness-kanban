import React, { createContext, useContext, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';

/** The active root conversation owned by the drawer's Conversations section. */
export interface ConversationActions {
  activeSessionId: string | null;
  canClose: boolean;
  pending: boolean;
  close(): void;
  label(sessionId: string): string;
}

const noActions: ConversationActions = {
  activeSessionId: null,
  canClose: false,
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
 * The drawer's close action consumes the active conversation through context:
 * the native session-header slot never receives drawer callbacks as props.
 * It renders nothing outside the drawer or when a subagent peek owns the view.
 */
export function ConversationCloseAction() {
  const actions = useConversationActions();
  const sessionId = actions.activeSessionId;
  if (!actions.canClose || sessionId === null) return null;
  const label = 'Close ' + actions.label(sessionId);
  return <button type="button" className="kb-button kb-icon-button kb-session-close" aria-label={label} title={label} disabled={actions.pending} onClick={() => actions.close()}>
    <CloseIcon size={14} />
  </button>;
}
