import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { LocatedTask } from '../hub-repository.js';
import { PAUSE_REASON_LIMIT, activeHold } from '../../domain/auto-mode-hold.js';
import { normal, text } from './support.js';
import { requireTask, type TaskScopeSource, type ToolArgs } from './scope.js';

/**
 * The narrow surface the pause tools need: the task lookup plus the two
 * operations. The module never reaches the rest of the application, so the
 * pause controls stay independent of the board, worktree, and conversation code.
 */
export interface TaskPausePort extends TaskScopeSource {
  pauseTask(taskId: string, reason: string): Promise<LocatedTask>;
  resumeTask(taskId: string): Promise<LocatedTask>;
}

/** One task's pause view: the scope, the setting, and the pause in effect. */
function pauseView(located: LocatedTask, note?: string) {
  const { task, board, hubId } = located;
  const hold = activeHold(task);
  return {
    hubId,
    taskId: task.id,
    board: { id: board.id, name: board.name },
    stage: { columnId: task.columnId, name: board.workflow.columns.find(column => column.id === task.columnId)?.name ?? task.columnId },
    position: task.position,
    autoModeEnabled: task.autoMode?.enabled === true,
    paused: hold !== undefined,
    ...(hold === undefined ? {} : { pause: { reason: hold.reason, at: hold.at } }),
    ...(task.recordedTransition === undefined ? {} : { recordedTransition: { columnId: task.recordedTransition.columnId, fromColumnId: task.recordedTransition.fromColumnId } }),
    ...(note === undefined ? {} : { note }),
  };
}

export function autoModeTools(port: TaskPausePort): ToolDefinition[] {
  return [
    normal('pause_task',
      'Pause the task so its automatic advance stops until a human resumes it. Auto mode stays enabled. Pass a short reason; it is presented on the card. This never moves the task, changes its position, sends a message, clears the recorded transition, or turns auto mode off. A task whose auto mode is disabled already does not advance, and is reported instead of paused.',
      {
        task_id: text('Task ID. Optional in a task conversation.'),
        reason: text('Why the task should wait. Required and shown on the card; ' + PAUSE_REASON_LIMIT + ' characters or fewer.', true),
      },
      async (args, exec) => {
        const located = requireTask(port, args as ToolArgs, exec);
        const updated = await port.pauseTask(located.task.id, args.reason);
        return pauseView(updated, updated.task.autoMode?.enabled === true
          ? undefined
          : 'Auto mode is disabled, so this task does not advance. No pause was recorded.');
      }),
    normal('resume_task',
      'Resume a paused task: clear the pause the agent requested and any recorded diagnostic pause, leaving auto mode as it is. This never moves the task, changes its position, sends a message, or advances a turn that already ended. A task that is not paused is reported unchanged, and a task whose auto mode is disabled is not enabled.',
      { task_id: text('Task ID. Optional in a task conversation.') },
      async (args, exec) => {
        const located = requireTask(port, args as ToolArgs, exec);
        const wasPaused = activeHold(located.task) !== undefined || located.task.autoMode?.pause !== undefined;
        const updated = await port.resumeTask(located.task.id);
        return pauseView(updated, wasPaused ? undefined : 'The task was not paused, so nothing changed.');
      }),
  ];
}
