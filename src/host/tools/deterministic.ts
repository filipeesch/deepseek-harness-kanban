import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import { readExecutionState } from '../../domain/deterministic-execution.js';
import { normal, text } from './support.js';
import { requireTask, type ToolArgs } from './scope.js';

/** The fields one simulated shell answer may carry. */
interface TestResponseArgs { readonly match: string; readonly exit_code?: number; readonly stdout?: string; readonly stderr?: string }
/** The fields the default simulated answer may carry; it needs no match. */
interface TestDefaultResponseArgs { readonly exit_code?: number; readonly stdout?: string; readonly stderr?: string }
interface TestScriptArgs extends ToolArgs {
  readonly board_id: string;
  readonly stage_id: string;
  readonly project_id?: string;
  readonly params?: Record<string, string>;
  readonly responses?: readonly TestResponseArgs[];
  readonly default_response?: TestDefaultResponseArgs;
}

/** The wire shape of one simulated answer the caller declares. */
const responseSpec = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    match: { type: 'string' as const, required: true as const, description: 'A substring the requested command must contain to take this answer.' },
    exit_code: { type: 'integer' as const, description: 'Exit status to report; defaults to zero.' },
    stdout: { type: 'string' as const, description: 'Standard output text the program reads.' },
    stderr: { type: 'string' as const, description: 'Standard error text the program reads.' },
  },
};

/** The wire shape of the answer a command no declared response covers receives. */
const defaultResponseSpec = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    exit_code: { type: 'integer' as const, description: 'Exit status to report; defaults to zero.' },
    stdout: { type: 'string' as const, description: 'Standard output text the program reads.' },
    stderr: { type: 'string' as const, description: 'Standard error text the program reads.' },
  },
};

/**
 * The scripted-execution tools for the workflow architect: one read of a task's
 * execution state, and one isolated test execution of a stage program.
 *
 * Neither starts, stops, retries, delivers, approves, or routes anything. The read
 * answers what the card, the drawer, and the board already present. The test runs
 * the program against a simulated shell, so a program can be debugged without a
 * card, a worktree, or a native shell call.
 */
export function deterministicTools(app: KanbanApp): ToolDefinition[] {
  return [
    normal('get_script_execution', 'Read one task scripted-step state without changing anything: the phase, the saved result and its destination, why a saved result is held and what clears that hold, the entry parameter values and missing declared names, the captured executable version, the attempt and restart counts, and the most recent execution and handoff records. It starts, stops, retries, or delivers nothing, approves no executable version, and carries no stored variable value, secret, or program source.', {
      task_id: text('Task ID. Optional in a task conversation.'),
    }, async (args, exec) => {
      const located = requireTask(app, args as ToolArgs, exec);
      const { task, board } = located;
      const column = board.workflow.columns.find(value => value.id === task.columnId);
      const identityOf = (id: string): string | undefined => board.localStageIdentities?.[id] ?? board.workflow.columns.find(value => value.id === id)?.key;
      const destinations: Record<string, { name: string; identity: string }> = {};
      for (const value of board.workflow.columns) {
        const identity = identityOf(value.id);
        if (identity !== undefined) destinations[value.id] = { name: value.name, identity };
      }
      return readExecutionState({
        taskId: task.id,
        available: app.scriptedExecutionAvailable,
        ...(task.stageEntry === undefined ? {} : { stageEntry: task.stageEntry }),
        ...(task.deterministic === undefined ? {} : { control: task.deterministic }),
        ...(task.deterministicHandoff === undefined ? {} : { handoff: task.deterministicHandoff }),
        ...(task.history === undefined ? {} : { history: task.history }),
        ...(column === undefined ? {} : { stage: {
          id: column.id, name: column.name,
          ...(identityOf(column.id) === undefined ? {} : { identity: identityOf(column.id)! }),
          ...(column.deterministic === undefined ? {} : { deterministic: column.deterministic }),
        } }),
        destinations,
      });
    }, true),
    normal('test_script', 'Run one stage authored program in an isolated test execution and report what it did: the chosen exit, the message, the destination that exit names in the stage, every shell command it would have run with the simulated answer that resolved it, and the failure when it produced no completion. The program receives exactly the parameter values supplied here and a simulated shell; it never reaches the native shell, never captures or approves an executable version, never creates an entry, conversation, or worktree, and never routes or moves a card. A Bash program cannot be tested this way because it is the shell script itself.', {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      project_id: text('One project of the board whose directory the program sees. Defaults to the first allowed project with a directory.'),
      params: { type: 'object', additionalProperties: true, description: 'The parameter values the program receives, exactly as declared by the stage.' },
      responses: { type: 'array', items: responseSpec, description: 'Simulated shell answers, tried in declaration order.' },
      default_response: defaultResponseSpec,
    }, async (args, exec) => {
      const input = args as unknown as TestScriptArgs;
      return app.testStageScript({
        boardId: input.board_id,
        stageId: input.stage_id,
        ...(input.project_id === undefined ? {} : { projectId: input.project_id }),
        parameters: input.params,
        responses: (input.responses ?? []).map(response => ({
          match: response.match,
          ...(response.exit_code === undefined ? {} : { exitCode: response.exit_code }),
          ...(response.stdout === undefined ? {} : { stdout: response.stdout }),
          ...(response.stderr === undefined ? {} : { stderr: response.stderr }),
        })),
        ...(input.default_response === undefined ? {} : { defaultResponse: {
          match: '',
          ...(input.default_response.exit_code === undefined ? {} : { exitCode: input.default_response.exit_code }),
          ...(input.default_response.stdout === undefined ? {} : { stdout: input.default_response.stdout }),
          ...(input.default_response.stderr === undefined ? {} : { stderr: input.default_response.stderr }),
        } }),
      }, exec.signal);
    }),
  ];
}
