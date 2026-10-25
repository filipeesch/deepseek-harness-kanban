import React, { createContext, useContext, type ReactNode } from 'react';
import type { Task } from '../shared/types.js';

/** Structural copy of the native direct-parent subagent address. */
export interface DrawerSubagentAddress {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode: 'one-shot' | 'continuable' | 'unknown';
}

export interface ConversationNavigation {
  /** Select a task root or peek an owned subagent ancestor. */
  openSession(sessionId: string): boolean;
  /** Peek a child selected by the native lineage or catalog. */
  openSubagent(address: DrawerSubagentAddress): boolean;
}

const noNavigation: ConversationNavigation = {
  openSession: () => false,
  openSubagent: () => false,
};

const NavigationContext = createContext<ConversationNavigation | null>(null);

export function ConversationNavigationProvider({ value, children }: { value: ConversationNavigation; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useConversationNavigation(): ConversationNavigation {
  return useContext(NavigationContext) ?? noNavigation;
}

/** The session list shape needed for native subagent lineage checks. */
export interface ConversationSessionRow {
  readonly origin?: 'subagent';
  readonly parentId?: string;
}

export interface ConversationSessionList {
  readonly byId: Readonly<Record<string, ConversationSessionRow | undefined>>;
}

/** Follow native subagent edges only; roots, forks, missing rows, and cycles fail closed. */
export function isOwnedSubagent(sessions: ConversationSessionList, rootSessionIds: readonly string[], sessionId: string): boolean {
  if (rootSessionIds.includes(sessionId)) return false;
  const seen = new Set<string>();
  let cursor: string | undefined = sessionId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const row: ConversationSessionRow | undefined = sessions.byId[cursor];
    if (row === undefined || row.origin !== 'subagent' || row.parentId === undefined) return false;
    if (rootSessionIds.includes(row.parentId)) return true;
    cursor = row.parentId;
  }
  return false;
}

/** Small adapter the drawer and tests use to resolve and validate subagent targets. */
export interface ConversationLineagePort {
  subagentAddress(sessionId: string): DrawerSubagentAddress | undefined;
  isOwnedDescendant(rootSessionIds: readonly string[], sessionId: string): boolean;
}

export function createConversationNavigation(options: {
  task: Task;
  selectRoot(sessionId: string): void;
  setPeek(address: DrawerSubagentAddress | null): void;
  lineage?: ConversationLineagePort;
}): ConversationNavigation {
  const { task, selectRoot, setPeek, lineage } = options;
  return {
    openSession(sessionId) {
      if (task.sessionIds.includes(sessionId)) {
        selectRoot(sessionId);
        return true;
      }
      if (lineage === undefined || !lineage.isOwnedDescendant(task.sessionIds, sessionId)) return false;
      const address = lineage.subagentAddress(sessionId);
      if (address === undefined) return false;
      setPeek(address);
      return true;
    },
    openSubagent(address) {
      if (lineage === undefined || !lineage.isOwnedDescendant(task.sessionIds, address.childSessionId)) return false;
      setPeek(address);
      return true;
    },
  };
}
