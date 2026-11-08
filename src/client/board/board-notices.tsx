import React, { type ReactNode } from 'react';
import type { Board, BoardState, HubSharingView, HubState, KanbanSnapshot, Problem, Task } from '../../shared/types.js';
import { BoardNotices } from '../board-notices.js';
import { DestructiveOperationsNotice, type RetainedCheckoutNotice } from '../destructive-notices.js';
import { ProjectRelocationNotice } from '../project-relocation-notice.js';

/** The publishing banner shown when the team has changes that need attention. */
export function ShareBanner({ view, onReview }: { view: HubSharingView | undefined; onReview: () => void }) {
  if (!view || view.status === 'preview' || view.status === 'not-published') return null;
  if (view.updates === 0 && view.conflicts === 0 && view.blockers.length === 0) return null;
  const message = view.conflicts > 0 ? 'Your team changed boards that also changed on this machine. Review the differences.' : view.updates > 0 ? 'Your team published changes to this Hub.' : view.blockers[0]?.message ?? 'Team changes cannot be applied until the blocking boards are resolved.';
  return <div className="kb-share-banner" role="status"><p>{message}</p><div className="kb-actions"><button type="button" className="kb-button" onClick={onReview}>Review team changes</button></div></div>;
}

export interface BoardProblemNoticesProps {
  loadError: Problem | null;
  actionError: Problem | null;
  onRetryLoad: () => void;
  state: BoardState | undefined;
  tasks: readonly Task[];
  retained: readonly RetainedCheckoutNotice[];
  onDismissRetained: (path: string) => void;
  onOpenTask: (taskId: string) => void;
  onRetryOperation: (taskId: string) => void;
  onForce: (taskId: string) => void;
  onReturn: (taskId: string) => void;
  onRelocationRetry: (projectId: string) => void;
}

/** Every status surface between the header and the board body. */
export function BoardProblemNotices({
  loadError, actionError, onRetryLoad, state, tasks, retained, onDismissRetained, onOpenTask, onRetryOperation, onForce, onReturn, onRelocationRetry,
}: BoardProblemNoticesProps) {
  return <>
    <BoardNotices loadError={loadError} actionError={actionError} onRetryLoad={onRetryLoad} />
    {state && <ProjectRelocationNotice projects={state.projects} onRetry={onRelocationRetry} />}
    {state && <DestructiveOperationsNotice tasks={tasks} retained={retained} onDismissRetained={onDismissRetained} onOpen={onOpenTask} onRetry={onRetryOperation} onForce={onForce} onReturn={onReturn} />}
  </>;
}

export interface BoardEmptyStatesProps {
  snapshot: KanbanSnapshot | null;
  loadError: Problem | null;
  hub: HubState | undefined;
  board: Board | undefined;
  onCreateHub: () => void;
  onCreateBoard: () => void;
}

/** Loading, no-Hub, no-board, and no-project states; the board renders one of them at a time. */
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

/** The page body shared by every board presentation. */
export function BoardBody({ children, bodyRef, onPointerDown, empty, flow = false }: BoardBodyProps) {
  return <div className={flow ? 'kb-page-body kb-page-body-flow' : 'kb-page-body'} ref={bodyRef} onPointerDown={onPointerDown}>{empty}{children}</div>;
}
