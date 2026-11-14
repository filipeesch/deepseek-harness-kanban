import type { Board, HubState, Project } from '../shared/types.js';
import type { DeterministicDefinition } from '../shared/deterministic.js';
import type { DeterministicRuntime, SimulatedShellResponse, TestProgramOutcome } from './deterministic/ports.js';
import { invariant } from '../shared/errors.js';
import { declaredParameterNames, validateParameterValues } from '../domain/deterministic-parameters.js';
import { requireProjectPath } from '../shared/project.js';
import { bounded } from './deterministic/safety.js';
import type { HubRepository } from './hub-repository.js';

/** One stage program run against a simulated shell; nothing here is durable. */
export interface ScriptTestResult {
  readonly boardId: string;
  readonly stageId: string;
  readonly projectId: string;
  readonly directory: string;
  readonly language: DeterministicDefinition['language'];
  readonly parameters: Readonly<Record<string, string>>;
  readonly outcome: TestProgramOutcome;
  /** The stage the chosen exit names, when the program completed. */
  readonly destination?: { readonly columnId: string; readonly stageName?: string };
}

export interface ScriptTestInput {
  readonly boardId: string;
  readonly stageId: string;
  readonly projectId?: string;
  readonly parameters: unknown;
  readonly responses: readonly SimulatedShellResponse[];
  readonly defaultResponse?: SimulatedShellResponse;
}

export interface ScriptTestDeps {
  readonly hubs: HubRepository;
  /** The native runtime, absent when the host cannot run scripted steps. */
  runtime(): DeterministicRuntime | undefined;
  readonly now?: () => string;
}

/** How many simulated shell answers one test call may declare. */
const MAX_SIMULATED_RESPONSES = 50;
/** The longest command match and the longest output text one declared answer contributes. */
const RESPONSE_TEXT_LIMIT = 64 * 1024;

/** One declared answer with its texts bounded before they reach the runtime. */
function boundResponse(response: SimulatedShellResponse): SimulatedShellResponse {
  return {
    match: bounded(response.match, 200),
    ...(response.exitCode === undefined ? {} : { exitCode: response.exitCode }),
    ...(response.stdout === undefined ? {} : { stdout: bounded(response.stdout, RESPONSE_TEXT_LIMIT) }),
    ...(response.stderr === undefined ? {} : { stderr: bounded(response.stderr, RESPONSE_TEXT_LIMIT) }),
  };
}

/** The project a test runs against: the named one, or the first allowed one that has a directory. */
function testProject(hub: HubState, board: Board, projectId: string | undefined): Project {
  const candidates = hub.projects.filter(project => project.projectPath !== undefined && (board.allowedProjectKeys === undefined || board.allowedProjectKeys.includes(project.projectKey)));
  if (projectId !== undefined) {
    const named = candidates.find(project => project.id === projectId);
    invariant(named !== undefined, 'PROJECT_NOT_FOUND', 'The board allows no project with that identifier and a directory.');
    return named;
  }
  const first = candidates[0];
  invariant(first !== undefined, 'PROJECT_DIRECTORY_MISSING', 'The board allows no project with a directory; register a project before testing this program.');
  return first;
}

/**
 * Run one stage's authored program in an isolated test execution.
 *
 * The source is resolved exactly as a real execution resolves it, so an external
 * file is read from the same directory, but nothing is captured, approved, stored,
 * delivered, routed, or recorded. The caller supplies the input values and every
 * simulated shell answer.
 */
export async function testStageScript(deps: ScriptTestDeps, input: ScriptTestInput, signal: AbortSignal): Promise<ScriptTestResult> {
  const located = deps.hubs.findBoard(input.boardId);
  invariant(located !== undefined, 'BOARD_NOT_FOUND', 'Board does not exist.');
  const { hub, board } = located;
  const column = board.workflow.columns.find(value => value.id === input.stageId);
  invariant(column !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + input.stageId + '.');
  const definition = column.deterministic;
  invariant(definition !== undefined, 'DETERMINISTIC_CONFIGURATION_REQUIRED', 'Stage ' + column.id + ' authors no script.');
  const declared = declaredParameterNames(definition.params);
  // A stage that declares nothing needs no values; an omitted argument is the same as an empty set.
  const checked = validateParameterValues(declared, input.parameters === undefined && declared.length === 0 ? {} : input.parameters);
  invariant(checked.ok, 'INVALID_PARAMETERS', checked.ok ? '' : checked.message);
  const runtime = deps.runtime();
  invariant(runtime?.test !== undefined, 'DETERMINISTIC_UNAVAILABLE', 'This host cannot run an isolated test execution.');
  invariant(input.responses.length <= MAX_SIMULATED_RESPONSES, 'INVALID_INPUT', 'At most ' + MAX_SIMULATED_RESPONSES + ' simulated responses are accepted.');
  const project = testProject(hub, board, input.projectId);
  const directory = requireProjectPath(project);
  const exits = Object.fromEntries(Object.entries(definition.exits).map(([name, columnId]) => [name, { columnId, stageIdentity: columnId }]));
  const plan = await runtime.plan({ definition, projectDirectory: directory, taskDirectory: directory, exits, signal });
  const startedAt = deps.now?.() ?? new Date().toISOString();
  const programInput = {
    task: { id: 'test', title: 'Test execution', description: '' },
    hub: { id: hub.id },
    board: { id: board.id },
    stage: { id: column.id, identity: column.key ?? column.id },
    project: { id: project.id, directory },
    directory,
    worktree: null,
    entryId: 'test',
    executionId: 'test',
    startedAt,
    attempt: 0,
    restartCount: 0,
    params: checked.values,
  };
  // The declared answers are caller input, but what a tested program reads back is bounded.
  const responses = input.responses.map(response => boundResponse(response));
  const outcome = await runtime.test({
    definition, code: plan.code, input: programInput, directory,
    responses, ...(input.defaultResponse === undefined ? {} : { defaultResponse: boundResponse(input.defaultResponse) }), signal,
  });
  const destination = outcome.kind === 'completed' ? definition.exits[outcome.completion.exit] : undefined;
  const stageName = destination === undefined ? undefined : board.workflow.columns.find(value => value.id === destination)?.name;
  return {
    boardId: board.id, stageId: column.id, projectId: project.id, directory, language: definition.language,
    parameters: checked.values, outcome,
    ...(destination === undefined ? {} : { destination: { columnId: destination, ...(stageName === undefined ? {} : { stageName }) } }),
  };
}
