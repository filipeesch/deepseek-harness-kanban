import React from 'react';
import type { HubState } from '../../shared/types.js';
import { CreateBoardDialog, CreateHubDialog } from '../create-dialogs.js';
import type { ContainerCreation } from '../use-creation-dialogs.js';
import type { TaskCreation } from '../use-task-creation.js';
import type { RunCommand } from '../ui.js';

export interface BoardCreationDialogsProps {
  hub: HubState | undefined;
  run: RunCommand;
  /** The board's single task-creation instance; its dialog serves both presentations. */
  task: TaskCreation;
  /** The New Hub and New Board dialogs, owned by their own hook. */
  containers: ContainerCreation;
}

/**
 * The dialogs that create a task, a Hub, or a board. Each is mounted from the state
 * its concern owns, so the New task dialog appears whichever presentation asked for
 * it and never twice.
 */
export function BoardCreationDialogs({ hub, run, task, containers }: BoardCreationDialogsProps) {
  return <>
    {task.dialog}
    {containers.newHub && <CreateHubDialog run={run} onClose={containers.closeHub} onCreated={containers.onHubCreated} />}
    {containers.newBoard && hub !== undefined && <CreateBoardDialog hubId={hub.id} run={run} onClose={containers.closeBoard} onCreated={containers.onBoardCreated} />}
  </>;
}
