import React, { type ReactNode } from 'react';
import type { Board, HubState, KanbanSnapshot, Problem } from '../../shared/types.js';

export interface BoardEmptyStatesProps {
  snapshot: KanbanSnapshot | null;
  loadError: Problem | null;
  hub: HubState | undefined;
  board: Board | undefined;
  onCreateHub: () => void;
  onCreateBoard: () => void;
}

/** Loading, no-Hub, no-board states; the board renders one of them at a time. */
export function BoardEmptyStates({ snapshot, loadError, hub, board, onCreateHub, onCreateBoard }: BoardEmptyStatesProps) {
  if (!snapshot && !loadError) return <p className="kb-empty" role="status">Loading Kanban…</p>;
  if (snapshot && !hub) return <div className="kb-empty"><h2>No Hub available</h2><p>Create a Hub to continue.</p><button type="button" className="kb-button kb-primary" onClick={onCreateHub}>Create Hub</button></div>;
  if (snapshot && hub && !board) return <div className="kb-empty"><h2>Create your first board</h2><p>Boards hold a workflow and their tasks inside this Hub.</p><button type="button" className="kb-button kb-primary" onClick={onCreateBoard}>Create board</button></div>;
  return null;
}

/** The in-body state shown while the board has no project to create a task in. */
export function ProjectsEmptyState({ onConfigureProjects }: { onConfigureProjects: () => void }) {
  return <div className="kb-empty"><h2>Add your first project</h2><p>Register a project folder, and its Git root when it is a repository, to create tasks.</p><button type="button" className="kb-button kb-primary" onClick={onConfigureProjects}>Configure projects</button></div>;
}

export interface BoardBodyProps {
  children: ReactNode;
  bodyRef: React.RefObject<HTMLDivElement>;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  empty: ReactNode;
  /** The diagram owns its own surface; the page body stops scrolling and fills it. */
  flow?: boolean;
}

/** The page body shared by every board presentation; it can receive focus after a dismissal. */
export function BoardBody({ children, bodyRef, onPointerDown, empty, flow = false }: BoardBodyProps) {
  return <div className={flow ? 'kb-page-body kb-page-body-flow' : 'kb-page-body'} ref={bodyRef} tabIndex={-1} onPointerDown={onPointerDown}>{empty}{children}</div>;
}
