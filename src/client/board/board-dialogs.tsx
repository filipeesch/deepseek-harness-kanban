import React from 'react';
import type { Board, BoardState, HubState, KanbanSnapshot } from '../../shared/types.js';
import { CreateBoardDialog, CreateHubDialog } from '../create-dialogs.js';
import { NewTaskDialog } from '../forms.js';
import type { RunCommand } from '../ui.js';

export interface BoardCreationDialogsProps {
  boardState: BoardState | undefined;
  hub: HubState | undefined;
  board: Board | undefined;
  run: RunCommand;
  newTask: boolean;
  newHub: boolean;
  newBoard: boolean;
  onCloseNewTask: () => void;
  onCloseNewHub: () => void;
  onCloseNewBoard: () => void;
  onTaskCreated: (taskId: string) => void;
  onHubCreated: (hubId: string) => void;
  onBoardCreated: (boardId: string) => void;
}

/** The dialogs that create a task, a Hub, or a board. */
export function BoardCreationDialogs({ boardState, hub, board, run, newTask, newHub, newBoard, onCloseNewTask, onCloseNewHub, onCloseNewBoard, onTaskCreated, onHubCreated, onBoardCreated }: BoardCreationDialogsProps) {
  return <>
    {newTask && boardState !== undefined && <NewTaskDialog state={boardState} run={run} onClose={onCloseNewTask} onCreated={onTaskCreated} />}
    {newHub && <CreateHubDialog run={run} onClose={onCloseNewHub} onCreated={onHubCreated} />}
    {newBoard && hub !== undefined && <CreateBoardDialog hubId={hub.id} run={run} onClose={onCloseNewBoard} onCreated={onBoardCreated} />}
  </>;
}
