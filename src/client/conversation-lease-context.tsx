import React, { createContext, useContext, type ReactNode } from 'react';
import type { ConversationLeaseRegistry } from './conversation-leases.js';

const ConversationLeasesContext = createContext<ConversationLeaseRegistry | null>(null);

/** Provide the lease scope owned by one mounted task drawer. */
export function ConversationLeasesProvider({ registry, children }: { registry: ConversationLeaseRegistry; children: ReactNode }) {
  return <ConversationLeasesContext.Provider value={registry}>{children}</ConversationLeasesContext.Provider>;
}

/** Read the drawer's lease scope; a conversation can only render inside a task drawer. */
export function useConversationLeases(): ConversationLeaseRegistry {
  const registry = useContext(ConversationLeasesContext);
  if (registry === null) throw new Error('Conversation leases are unavailable outside a task drawer.');
  return registry;
}

/** Read the drawer's lease scope when the current surface may render outside a leased drawer. */
export function useOptionalConversationLeases(): ConversationLeaseRegistry | null {
  return useContext(ConversationLeasesContext);
}
