import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkflowView } from '../shared/types.js';
import { EMPTY_DRAWER_VIEW, type DrawerView, type ForkClaim } from './drawer-view.js';

export type DrawerSection = 'Conversations' | 'Info' | 'Git' | 'Notes' | 'Relations' | 'History';
export interface InfoDraft { title: string; description: string }
/** The view state of one open task drawer; plugin-lifetime bookmarks, never task facts. */
export interface TaskPageState {
  section: DrawerSection;
  /** The conversation surface the Conversations section presents. */
  view: DrawerView;
  /** The fork this drawer claimed and is waiting for the host to attach. */
  claim: ForkClaim | null;
  infoDraft?: InfoDraft;
  noteTagFilter?: string;
}
/** Plugin-lifetime UI bookmarks only: never store native views, transports, or session references here. */
export interface BoardPageState {
  search: string;
  projectFilter: string;
  selectedTaskId: string | null;
  drawers: Record<string, TaskPageState>;
  /** The presentation in use; the board resets it to the active board's default. */
  view: WorkflowView;
  /** The team-state signature the user dismissed, per Hub; this page session only. */
  dismissedTeamBanner: Record<string, string>;
}

export function createBoardPageState(): BoardPageState {
  return { search: '', projectFilter: '', selectedTaskId: null, drawers: Object.create(null) as Record<string, TaskPageState>, view: 'board', dismissedTeamBanner: Object.create(null) as Record<string, string> };
}

export function createTaskPageState(): TaskPageState { return { section: 'Conversations', view: EMPTY_DRAWER_VIEW, claim: null }; }

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
