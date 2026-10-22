import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export type DrawerSection = 'Conversations' | 'Info' | 'Git' | 'Notes';
export interface TaskPageState { section: DrawerSection; conversationId: string | null; conversationSelectionRequired?: boolean }
/** Plugin-lifetime UI bookmarks only: never store native views, transports, or session references here. */
export interface BoardPageState {
  search: string;
  projectFilter: string;
  archive: boolean;
  selectedTaskId: string | null;
  drawers: Record<string, TaskPageState>;
}

export function createBoardPageState(): BoardPageState {
  return { search: '', projectFilter: '', archive: false, selectedTaskId: null, drawers: Object.create(null) as Record<string, TaskPageState> };
}

export function createTaskPageState(): TaskPageState { return { section: 'Conversations', conversationId: null }; }

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
