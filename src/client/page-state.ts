import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { openSessionIds } from '../shared/conversations.js';

export type DrawerSection = 'Conversations' | 'Info' | 'Git' | 'Notes';
export interface InfoDraft { title: string; description: string }
export interface TaskPageState { section: DrawerSection; conversationId: string | null; conversationSelectionRequired?: boolean; infoDraft?: InfoDraft }
/** Plugin-lifetime UI bookmarks only: never store native views, transports, or session references here. */
export interface BoardPageState {
  search: string;
  projectFilter: string;
  selectedTaskId: string | null;
  drawers: Record<string, TaskPageState>;
}

export function createBoardPageState(): BoardPageState {
  return { search: '', projectFilter: '', selectedTaskId: null, drawers: Object.create(null) as Record<string, TaskPageState> };
}

export function createTaskPageState(): TaskPageState { return { section: 'Conversations', conversationId: null }; }

/** Pick the visible conversation for the tab strip and the status row. */
export function resolveActiveConversation(sessionIds: readonly string[], closedSessionIds: readonly string[], selected: string | null, fallbackAllowed: boolean): string | null {
  const open = openSessionIds({ sessionIds, closedSessionIds });
  if (selected !== null && open.includes(selected)) return selected;
  return fallbackAllowed ? open[0] ?? null : null;
}

export function taskPageState(state: BoardPageState, taskId: string): TaskPageState {
  if (!Object.prototype.hasOwnProperty.call(state.drawers, taskId)) state.drawers[taskId] = createTaskPageState();
  return state.drawers[taskId]!;
}

/** Write through synchronously so a navigation unmount cannot race a deferred persistence effect. */
export function usePageField<T extends object, K extends keyof T>(source: T, key: K): [T[K], Dispatch<SetStateAction<T[K]>>] {
  const [, redraw] = useState(0);
  const setValue = useCallback((update: SetStateAction<T[K]>) => {
    const next = typeof update === 'function' ? (update as (previous: T[K]) => T[K])(source[key]) : update;
    if (Object.is(next, source[key])) return;
    source[key] = next;
    redraw(value => value + 1);
  }, [source, key]);
  return [source[key], setValue];
}
