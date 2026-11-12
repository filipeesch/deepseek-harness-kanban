import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { LocatedTask } from '../hub-repository.js';
import { defaultDestination, transitionTargets } from '../../domain/transitions.js';
import { recordedTransition, staleTransitionMessage } from '../../domain/transition-route.js';
import { invariant } from '../../shared/errors.js';
import { normal, text } from './support.js';
import { requireOwnTask, requireTask, type TaskScopeSource, type ToolArgs } from './scope.js';

/** The routing write one task accepts: a configured target with its reason and values, or a clear. */
export interface TransitionWrite { columnId?: string; reason?: string; parameters?: Record<string, string> }

/**
 * The narrow surface the transition tools need: the task lookup plus the one
 * write. The module never reaches the board repository, the command lane, or the
 * snapshot, so these tool rules are testable against the port alone.
 */
export interface TaskRoutingPort extends TaskScopeSource {
  recordTransition(taskId: string, write: TransitionWrite): Promise<LocatedTask>;
}

/** One task's routing view: its stage, its configured targets, and its declaration. */
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
      ...(target.column.deterministic?.params === undefined ? {} : { parameters: target.column.deterministic.params.map(parameter => ({ name: parameter.name, ...(parameter.description === undefined ? {} : { description: parameter.description }) })) }),
    })),
    ...(fallback === undefined ? {} : { defaultColumnId: fallback.id }),
    recorded: recorded === undefined
      ? null
      : { columnId: recorded.columnId, fromColumnId: recorded.fromColumnId, at: recorded.at, ...(recorded.reason === undefined ? {} : { reason: recorded.reason }), ...(recorded.parameters === undefined ? {} : { parameters: recorded.parameters }) },
    ...(resolution.kind === 'stale' ? { recordedProblem: staleTransitionMessage(board.workflow, task, resolution.reason) } : {}),
    /** Whether the declared transition moves the task at the end of its next completed turn. */
    armed: resolution.kind === 'resolved' && recorded?.reason !== undefined,
  };
}

export function transitionTools(port: TaskRoutingPort): ToolDefinition[] {
  return [
    normal('list_allowed_transitions',
      'List the transitions configured by the current stage of the task, with the condition attached to each destination, the destination used when nothing is declared, and the transition currently declared. Read this before choosing where the task goes next. Accepts a task identifier; a task conversation resolves its own task.',
      { task_id: text('Task ID. Optional in a task conversation.') },
      async (args, exec) => transitionView(requireTask(port, args as ToolArgs, exec)),
      true),
    normal('set_next_transition',
      'Declare the transition the task follows at the end of this turn, and the reason for it. Use it only when the transition was explicitly asked for, by the user or by the stage instruction. Pass column_id from list_allowed_transitions together with reason; omit column_id to clear the declaration, which needs no reason. The call itself never moves the task, sends a message, or changes auto mode: the task moves at the end of its next completed turn, whether or not auto mode is enabled, and only this task — the one that owns the calling conversation.',
      {
        column_id: text('Destination stage ID from list_allowed_transitions. Omit to clear the declaration.'),
        reason: text('Why the task belongs in that stage, in your own words. Required with a target and shown to the next stage; omitted only when clearing.'),
        parameters: { type: 'object', additionalProperties: true, description: 'Values for the destination stage parameters reported by list_allowed_transitions. Supply exactly the declared names with nonempty string values; a rejection lists the accepted names.' },
      },
      async (args, exec) => {
        // The schema offers no task identifier. A model that sends one anyway is
        // told so instead of silently routing its own task and believing otherwise.
        invariant((args as ToolArgs).task_id === undefined, 'TASK_SCOPE_NOT_ACCEPTED',
          'set_next_transition acts on the task that owns the calling conversation and takes no task_id. Call it from that task conversation.');
        invariant(args.column_id !== undefined || args.parameters === undefined, 'INVALID_PARAMETERS',
          'Parameters require a destination stage. Omit parameters to clear the recorded transition.');
        const located = requireOwnTask(port, exec);
        return transitionView(await port.recordTransition(located.task.id, {
          ...(args.column_id === undefined ? {} : { columnId: args.column_id }),
          ...(args.reason === undefined ? {} : { reason: args.reason }),
          ...(args.parameters === undefined ? {} : { parameters: args.parameters as Record<string, string> }),
        }));
      }),
  ];
}
