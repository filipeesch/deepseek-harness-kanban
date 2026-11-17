import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { LocatedTask } from '../hub-repository.js';
import { defaultDestination, transitionTargets } from '../../domain/transitions.js';
import { recordedTransition, staleTransitionMessage } from '../../domain/transition-route.js';
import { invariant } from '../../shared/errors.js';
import { flag, normal, text } from './support.js';
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
  recordExceptionalTransition?(taskId: string, write: TransitionWrite & { columnId: string }, sessionId: string): Promise<LocatedTask>;
  exceptionalTransitionArmed?(taskId: string, exceptionId: string): boolean;
}

/** One task's routing view: its stage, its configured targets, and its declaration. */
function transitionView(located: LocatedTask, destinationId?: string, port?: TaskRoutingPort) {
  const { task, board, hubId } = located;
  const source = board.workflow.columns.find(column => column.id === task.columnId);
  const recorded = task.recordedTransition;
  const resolution = recordedTransition(board.workflow, task);
  const fallback = defaultDestination(board.workflow, task.columnId);
  const destination = destinationId === undefined ? undefined : board.workflow.columns.find(column => column.id === destinationId);
  invariant(destinationId === undefined || destination !== undefined, 'INVALID_TARGET', 'The requested destination does not exist in this task’s board.');
  const decision = source?.decision;
  // A stage that owns its routing reports who owns it, so a reader never mistakes
  // authored destinations for targets it may declare.
  const routingOwner = source?.scripted !== undefined ? 'scripted' : decision !== undefined ? 'decision' : 'stage';
  const declarable = source?.allowedTransitions !== undefined;
  return {
    routingOwner,
    declarable,
    ...(decision === undefined ? {} : { decision: { question: decision.question, answeredBy: 'person', options: decision.options.map(option => ({ id: option.id, title: option.title, to: option.to })) } }),
    ...(destination === undefined ? {} : { requestedDestination: { columnId: destination.id, name: destination.name, parameters: (destination.scripted?.params ?? []).map(parameter => ({ name: parameter.name, ...(parameter.description === undefined ? {} : { description: parameter.description }) })) } }),
    hubId,
    taskId: task.id,
    board: { id: board.id, name: board.name },
    stage: { columnId: task.columnId, name: source?.name ?? task.columnId },
    configured: source?.allowedTransitions !== undefined,
    targets: decision === undefined ? transitionTargets(board.workflow, task.columnId).map(target => ({
      columnId: target.column.id,
      name: target.column.name,
      ...(target.rule.when === undefined ? {} : { when: target.rule.when }),
      ...(target.column.scripted?.params === undefined ? {} : { parameters: target.column.scripted.params.map(parameter => ({ name: parameter.name, ...(parameter.description === undefined ? {} : { description: parameter.description }) })) }),
    })) : [],
    ...(fallback === undefined ? {} : { defaultColumnId: fallback.id }),
    recorded: recorded === undefined
      ? null
      : { columnId: recorded.columnId, fromColumnId: recorded.fromColumnId, at: recorded.at, ...(recorded.reason === undefined ? {} : { reason: recorded.reason }), ...(recorded.parameters === undefined ? {} : { parameters: recorded.parameters }), ...(recorded.exception === undefined ? {} : { exceptional: true, boundToOriginatingTurn: true }) },
    ...(resolution.kind === 'stale' ? { recordedProblem: staleTransitionMessage(board.workflow, task, resolution.reason) } : {}),
    /** Ordinary declarations persist; exceptions arm only their live originating turn. */
    armed: recorded?.exception !== undefined
      ? port?.exceptionalTransitionArmed?.(task.id, recorded.exception.id) === true
      : resolution.kind === 'resolved' && recorded?.reason !== undefined,
  };
}

export function transitionTools(port: TaskRoutingPort): ToolDefinition[] {
  return [
    normal('list_allowed_transitions',
      'List the transitions configured by the current stage of the task, with the condition attached to each destination, the destination used when nothing is declared, and the transition currently declared. Read this before choosing where the task goes next. Accepts a task identifier; a task conversation resolves its own task. Optionally inspect an existing destination by ID, including its declared parameter names and descriptions, without claiming it is configured.',
      { task_id: text('Task ID. Optional in a task conversation.'), destination_id: text('Optional existing destination stage ID to inspect, even when not configured as a target.') },
      async (args, exec) => transitionView(requireTask(port, args as ToolArgs, exec), args.destination_id, port),
      true),
    normal('set_next_transition',
      'Declare the transition the task follows at the end of this turn, and the reason for it. Use it when the user asked for that transition, when this conversation\'s stage instruction asked for it, or when a message from another task explicitly asks for it. A request from another task does not override this task\'s stage: the destination must be one the current stage configures unless the exception flag applies. The reason is required, and the stage\'s conditions, scripted entry, and pending work still decide whether the task may leave. Pass column_id from list_allowed_transitions together with reason; omit column_id to clear the declaration, which needs no reason. The call never moves the task, sends a message, or changes auto mode. An ordinary declaration arms the next completed turn; an exceptional declaration can be admitted only on the observed completion of its originating turn. Both remain subject to entry and admission guards, regardless of auto mode. Only the task owning this conversation can be affected.',
      {
        column_id: text('Destination stage ID from list_allowed_transitions. Omit to clear the declaration.'),
        reason: text('Why the task belongs in that stage, in your own words. Required with a target and shown to the next stage; omitted only when clearing.'),
        exception: flag('Request an unconfigured destination only when the user directly and explicitly requested it in this task conversation. A stage instruction, peer request, or your own decision does not qualify. This flag is not proof of user intent.'),
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
        // The gate is answered by the person through the task surface; no product tool
        // declares a route out of it, with or without the exception flag.
        invariant(located.board.workflow.columns.find(column => column.id === located.task.columnId)?.decision === undefined,
          'DECISION_OWNED_ROUTE', 'This stage is a decision gate. The person answers it through the gate; no agent declares its route.');
        if (args.exception === true && args.column_id !== undefined && !transitionTargets(located.board.workflow, located.task.columnId).some(target => target.column.id === args.column_id)) {
          invariant(args.column_id !== located.task.columnId && located.board.workflow.columns.some(column => column.id === args.column_id), 'INVALID_TARGET', 'An exceptional destination must be another existing stage in this task’s board.');
          invariant(port.recordExceptionalTransition && exec.agent?.id, 'EXCEPTION_TURN_UNAVAILABLE', 'The originating open turn cannot be verified on this host. Use a configured transition or ask the workflow architect to update the workflow.');
          return transitionView(await port.recordExceptionalTransition(located.task.id, { columnId: args.column_id, ...(args.reason === undefined ? {} : { reason: args.reason }), ...(args.parameters === undefined ? {} : { parameters: args.parameters as Record<string, string> }) }, exec.agent.id), undefined, port);
        }
        return transitionView(await port.recordTransition(located.task.id, {
          ...(args.column_id === undefined ? {} : { columnId: args.column_id }),
          ...(args.reason === undefined ? {} : { reason: args.reason }),
          ...(args.parameters === undefined ? {} : { parameters: args.parameters as Record<string, string> }),
        }), undefined, port);
      }),
  ];
}