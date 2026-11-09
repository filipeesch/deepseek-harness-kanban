import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { LocatedTask } from '../hub-repository.js';
import { defaultDestination, transitionTargets } from '../../domain/transitions.js';
import { recordedTransition, staleTransitionMessage } from '../../domain/transition-route.js';
import { invariant } from '../../shared/errors.js';
import { normal, text } from './support.js';
import { requireTask, type ToolArgs } from './scope.js';

/** One task's routing view: its stage, its configured targets, and its recording. */
function transitionView(located: LocatedTask) {
  const { task, board, hubId } = located;
  const source = board.workflow.columns.find(column => column.id === task.columnId);
  const recorded = task.recordedTransition;
  const resolution = recordedTransition(board.workflow, task);
  const fallback = defaultDestination(board.workflow, task.columnId);
  return {
    hubId,
    taskId: task.id,
    board: { id: board.id, name: board.name },
    stage: { columnId: task.columnId, name: source?.name ?? task.columnId },
    configured: source?.allowedTransitions !== undefined,
    targets: transitionTargets(board.workflow, task.columnId).map(target => ({
      columnId: target.column.id,
      name: target.column.name,
      ...(target.rule.when === undefined ? {} : { when: target.rule.when }),
    })),
    ...(fallback === undefined ? {} : { defaultColumnId: fallback.id }),
    recorded: recorded === undefined ? null : { columnId: recorded.columnId, fromColumnId: recorded.fromColumnId, at: recorded.at },
    ...(resolution.kind === 'stale' ? { recordedProblem: staleTransitionMessage(board.workflow, task, resolution.reason) } : {}),
  };
}

export function transitionTools(app: KanbanApp): ToolDefinition[] {
  return [
    normal('list_allowed_transitions',
      'List the transitions configured by the current stage of the task, with the condition attached to each destination, the destination used when nothing is recorded, and the transition currently recorded. Read this before choosing where the task goes next.',
      { task_id: text('Task ID. Optional in a task conversation.') },
      async (args, exec) => transitionView(requireTask(app, args as ToolArgs, exec)),
      true),
    normal('set_next_transition',
      'Record which configured transition the task follows on its next advance. Pass column_id from list_allowed_transitions, or omit it to clear the recording. This never moves the task, changes its position, sends a message, or changes auto mode.',
      { task_id: text('Task ID. Optional in a task conversation.'), column_id: text('Destination stage ID from list_allowed_transitions. Omit to clear the recording.') },
      async (args, exec) => {
        const located = requireTask(app, args as ToolArgs, exec);
        await app.command({ type: 'task.recordTransition', hubId: located.hubId, taskId: located.task.id, ...(args.column_id === undefined ? {} : { columnId: args.column_id }) });
        const updated = app.hubs.findTask(located.task.id);
        invariant(updated, 'TASK_NOT_FOUND', 'Task does not exist.');
        return transitionView(updated);
      }),
  ];
}
