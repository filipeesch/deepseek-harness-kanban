import type { Board, HubState, Task } from '../shared/types.js';
import { orientStage, type OrientationExit, type StageOrientation } from '../domain/stage-orientation.js';
import { summaryScopeFacts, summarySharingFacts, summaryTaskFacts, type WorkflowHeldState, type WorkflowSharing } from './workflow-summary.js';

/**
 * The first-contact workflow map's own budget in UTF-8 bytes. It is separate from
 * the attachment listing's budget, so a task's files never take room from the
 * stages an agent needs to navigate.
 */
export const WORKFLOW_MAP_BUDGET = 16 * 1024;

export interface WorkflowMapInput {
  readonly board: Board;
  readonly hub: Pick<HubState, 'id' | 'name'>;
  readonly sharing: WorkflowSharing;
  /** The task whose conversation receives the map; absent renders the workflow alone. */
  readonly task?: Task;
  readonly held?: WorkflowHeldState;
}

const bytes = (text: string): number => Buffer.byteLength(text);
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const indent = (text: string): string => text.trim().split('\n').map(line => '    ' + line).join('\n');

function exitText(exit: OrientationExit): string {
  if (exit.exit !== undefined) return 'exit ' + exit.exit + ' -> ' + exit.to.id;
  if (exit.option !== undefined) return 'option ' + exit.option.id + ' (' + oneLine(exit.option.title) + ') -> ' + exit.to.id;
  return '-> ' + exit.to.id + (exit.condition === undefined ? '' : ' [when: ' + oneLine(exit.condition) + ']');
}

/** One stage: its identity line, its responsibility when authored, and its exits with their conditions. */
function stageEntry(orientation: StageOrientation, current: boolean): string {
  const { stage, routing, exits } = orientation;
  const lines = [(current ? '* ' : '  ') + stage.id + ' | ' + stage.name + ' | ' + stage.kind + ' | ' + routing];
  if (stage.responsibility !== undefined) lines.push(indent(stage.responsibility));
  lines.push('    exits: ' + (routing === 'unrestricted' ? 'any other stage' : exits.length === 0 ? 'none' : exits.map(exitText).join('; ')));
  return lines.join('\n');
}

function header(input: WorkflowMapInput): string {
  const { board, hub, task } = input;
  const workflow = board.workflow;
  const scope = summaryScopeFacts(board);
  const sharing = summarySharingFacts(board, input.sharing);
  const lines = [
    'Workflow: ' + workflow.name + (workflow.description?.trim() ? ' - ' + workflow.description.trim() : ''),
    'Board: ' + board.name + ' (' + board.id + ') | Hub: ' + hub.name + ' (' + hub.id + ') | Initial stage: ' + workflow.initialColumnId,
    'Scope: ' + (scope.mode === 'all' ? 'all projects' : 'restricted to ' + scope.projectCount + ' project' + (scope.projectCount === 1 ? '' : 's'))
      + ' | Sharing: ' + sharing.status + (sharing.bound === null ? '' : sharing.bound ? ', board bound' : ', board not bound'),
  ];
  if (task !== undefined) {
    const facts = summaryTaskFacts(workflow, task, input.held ?? 'unavailable');
    const stage = 'name' in facts.currentStage ? facts.currentStage.name + ' (' + facts.currentStage.id + ')' : facts.currentStage.id + ' (unavailable)';
    const held = facts.autoMode.held === 'unavailable' ? 'hold unknown' : facts.autoMode.held ? 'held' : 'not held';
    lines.push('Task stage: ' + stage + ' | Auto mode: ' + (facts.autoMode.enabled ? 'enabled' : 'disabled') + ', ' + (facts.autoMode.paused ? 'paused' : 'not paused') + ', ' + held);
  }
  lines.push("Stages in workflow order; * marks the task's stage. Each stage lists its responsibility, then its exits (conditions in brackets).");
  return lines.join('\n');
}

/** At most this many omitted stages are named by the closing line; the count it states is always exact. */
export const OMISSION_NAME_LIMIT = 40;
/** The bytes the closing line gives to stage names. A name that does not fit whole is not listed. */
export const OMISSION_NAMES_BUDGET = 1024;

function closing(count: number, listed: string): string {
  return count + ' stage' + (count === 1 ? '' : 's') + ' omitted for length, each left out whole' + listed + '. Read them with get_workflow_summary.';
}

/**
 * The closing line: the exact count, then the leading omitted stages that fit the
 * name allowance, then where to read them. The allowance is the fixed one or, when
 * less room is left in the map, what is left after the count and the pointer; the
 * shortest line, the count and the pointer alone, is always written.
 */
function omission(omitted: ReadonlyArray<{ id: string; name: string }>, room: number): string {
  const allowance = Math.min(OMISSION_NAMES_BUDGET, room - bytes(closing(omitted.length, ': , and ' + omitted.length + ' more')));
  const names: string[] = [];
  let used = 0;
  for (const stage of omitted.slice(0, OMISSION_NAME_LIMIT)) {
    const label = stage.id + ' (' + stage.name + ')';
    // The separator is counted with every name, so the allowance is never exceeded.
    if (used + bytes(label) + 2 > allowance) break;
    names.push(label);
    used += bytes(label) + 2;
  }
  const rest = omitted.length - names.length;
  const listed = names.length === 0 ? '' : ': ' + names.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : '');
  return closing(omitted.length, listed);
}

/** The most bytes the closing line can take for a workflow of this many stages, whichever stages it names. */
function omissionCeiling(stages: number): number {
  return bytes(closing(stages, ': , and ' + stages + ' more')) + OMISSION_NAMES_BUDGET + 1;
}

/**
 * The compact workflow map of a conversation's first-contact context: one entry
 * per stage in workflow order, the task's stage marked, no entry instruction,
 * script, or YAML. Within the budget it is complete. Over it, the header and the
 * task's stage come first, then the stage's own destinations, then the rest in
 * workflow order; a stage that does not fit is left out whole, never cut, and
 * named in a closing line (the exact count, then the names that fit a fixed allowance)
 * so the agent knows where to read it. The header and the task's own stage are always
 * kept whole, and so is the shortest closing line, so only they can take the map past
 * its budget.
 */
export function renderWorkflowMap(input: WorkflowMapInput, budget: number = WORKFLOW_MAP_BUDGET): string {
  const workflow = input.board.workflow;
  const currentId = input.task === undefined ? undefined : input.task.columnId;
  const entries = workflow.columns.map(column => {
    const orientation = orientStage(workflow, column.id)!;
    return { id: column.id, name: column.name, orientation, text: stageEntry(orientation, column.id === currentId) };
  });
  const top = header(input);
  const complete = [top, ...entries.map(entry => entry.text)].join('\n');
  if (bytes(complete) <= budget) return complete;

  const current = entries.findIndex(entry => entry.id === currentId);
  const order: number[] = [];
  if (current >= 0) {
    order.push(current);
    for (const exit of entries[current]!.orientation.exits) {
      const index = entries.findIndex(entry => entry.id === exit.to.id);
      if (index >= 0 && !order.includes(index)) order.push(index);
    }
  }
  for (let index = 0; index < entries.length; index++) if (!order.includes(index)) order.push(index);

  // Reserve the most the closing line can take, so a kept stage never pushes it out.
  const reserve = omissionCeiling(entries.length);
  let used = bytes(top) + 1;
  const kept = new Set<number>();
  for (const index of order) {
    const size = bytes(entries[index]!.text) + 1;
    // The task's own stage is always kept whole, whatever it costs.
    if (index === current || used + size + reserve <= budget) { kept.add(index); used += size; }
  }
  const lines = [top, ...entries.filter((_, index) => kept.has(index)).map(entry => entry.text)];
  const omitted = entries.filter((_, index) => !kept.has(index));
  // What the kept stages left is what the closing line may use, so it never pushes the map past the budget by itself.
  if (omitted.length > 0) lines.push(omission(omitted, budget - used));
  return lines.join('\n');
}
