import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import type { BoardState, KanbanSnapshot, Project } from '../shared/types.js';
import { isRegisteredProject } from '../shared/project.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { NEW_TASK_LABEL } from './board-copy.js';
import type { AutoRunController } from './auto-run.js';
import { NewTaskDialog, type CreatedTaskOptions } from './forms.js';
import { PlusIcon } from './icons.js';
import type { RunCommand } from './ui.js';

/** What the board owns and task creation only drives. */
export interface UseTaskCreationPort {
  readonly state: BoardState | undefined;
  /** The projects the board may create a task in, already narrowed by its scope. */
  readonly projects: readonly Project[];
  /** A board whose scope records no project accepts no new task. */
  readonly closedForCreation: boolean;
  readonly run: RunCommand;
  readonly autoRun: AutoRunController;
  /** Opens the task drawer; a created task is always shown. */
  readonly onOpenTask: (taskId: string) => void;
  /** The newest snapshot, read when a created task's start is decided. */
  readonly latest: () => KanbanSnapshot | null;
}

export interface TaskCreation {
  /** False when no registered project can own a task; both presentations disable the action. */
  readonly canCreate: boolean;
  readonly open: boolean;
  openDialog(): void;
  closeDialog(): void;
  /** The action the column board presents at the top of the initial column. */
  renderButton(): ReactNode;
  /** The one New task dialog both presentations open, mounted by the board. */
  readonly dialog: ReactNode;
}

/**
 * Task creation for the active board, owned by the board as a single instance and
 * consumed by both presentations: the column board renders the button it returns,
 * and the workflow diagram opens the same dialog through its creation port. One
 * instance is what keeps the two New task actions from drifting in label,
 * enablement, or the first-execution handoff, so a second call site would defeat
 * the point of this hook.
 *
 * It owns task creation only. The New Hub and New Board dialogs live in
 * `use-creation-dialogs`, because the two concerns share nothing but being dialogs.
 */
export function useTaskCreation(port: UseTaskCreationPort): TaskCreation {
  const portRef = useRef(port); portRef.current = port;
  const [open, setOpen] = useState(false);
  const openDialog = useCallback(() => { setOpen(true); }, []);
  const closeDialog = useCallback(() => { setOpen(false); }, []);
  // Creation opens the drawer immediately; an instructed initial stage then prepares
  // the first execution and arms the countdown through the existing controller.
  const onCreated = useCallback((taskId: string, options: CreatedTaskOptions) => {
    const current = portRef.current;
    current.onOpenTask(taskId);
    if (!options.start) return;
    const snapshot = current.latest();
    if (snapshot === null) return;
    const task = snapshot.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === taskId);
    if (task === undefined) return;
    const board = snapshot.state.hubs.flatMap(hub => hub.boards).find(value => value.id === task.boardId);
    const instruction = entryInstruction(board?.workflow.columns.find(value => value.id === task.columnId));
    const marker = task.instructionPending;
    if (instruction === undefined || marker?.columnId !== task.columnId) return;
    void current.autoRun.prepare({ taskId, columnId: task.columnId, enteredAt: marker.enteredAt, instruction }, async () => {
      await current.run({ type: 'task.prepareFirstExecution', taskId, columnId: task.columnId, expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction });
    });
  }, []);
  // Availability asks the Hub registry one question: is there a project that could own
  // a task at all. A published placeholder has no directory and is never offered by the
  // dialog, so counting it would enable an action that cannot save. The board's own
  // project scope is deliberately not asked here — a board that allows nothing must
  // still reach the experience that explains why it accepts no task — and the same
  // answer drives both presentations, because an action only one of them could see
  // would be a different feature.
  const canCreate = port.state !== undefined && port.state.projects.some(isRegisteredProject);
  const renderButton = useCallback((): ReactNode => <div className="kb-column-create"><button type="button" className="kb-button kb-primary" disabled={!canCreate} onClick={openDialog} aria-label={NEW_TASK_LABEL}><PlusIcon size={14} /> {NEW_TASK_LABEL}</button></div>, [canCreate, openDialog]);
  const dialog = open && port.state !== undefined
    ? <NewTaskDialog state={port.state} projects={port.projects} closedForCreation={port.closedForCreation} run={port.run} onClose={closeDialog} onCreated={onCreated} />
    : null;
  return { canCreate, open, openDialog, closeDialog, renderButton, dialog };
}
