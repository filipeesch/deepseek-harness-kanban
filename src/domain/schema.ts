import { z } from 'zod';
import { DATA_VERSION, type BoardState } from '../shared/types.js';
import { absolutePath, baseTask, canonicalWorkflow, createTaskInvariantChecker, nonempty, note, project, revision, workflow } from './schema-parts.js';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from './workflow.js';

const settings = z.strictObject({ worktreeBasePath: absolutePath.optional() });

/** Validates persisted data without resetting unknown versions or dropping orphaned records. */
export const BoardStateSchema: z.ZodType<BoardState> = z.strictObject({
  schemaVersion: z.literal(DATA_VERSION), revision, workflowYaml: nonempty, workflow,
  projects: z.array(project), tasks: z.array(baseTask), notes: z.array(note), settings: settings.optional(),
}).superRefine((state, context) => {
  const issue = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: 'custom', path, message });
  };
  const unique = (values: string[], path: (string | number)[]): void => {
    if (new Set(values).size !== values.length) issue(path, 'Identifiers must be unique.');
  };
  unique(state.projects.map(value => value.id), ['projects']);
  unique(state.tasks.map(value => value.id), ['tasks']);
  unique(state.notes.map(value => value.id), ['notes']);
  unique(state.workflow.columns.map(value => value.id), ['workflow', 'columns']);
  unique(state.workflow.groups.map(value => value.id), ['workflow', 'groups']);
  const projectIds = new Set(state.projects.map(value => value.id));
  const taskIds = new Set(state.tasks.map(value => value.id));
  const columnIds = new Set(state.workflow.columns.map(value => value.id));
  if (!columnIds.has(state.workflow.initialColumnId)) issue(['workflow', 'initialColumnId'], 'Initial column must exist.');
  const checker = createTaskInvariantChecker(projectIds, issue);
  for (const [index, value] of state.tasks.entries()) checker.check(value, index, columnIds);
  for (const [index, value] of state.notes.entries()) {
    if (!taskIds.has(value.taskId)) issue(['notes', index, 'taskId'], 'Note task does not exist.');
  }
  try {
    const parsed = parseWorkflow(state.workflowYaml);
    if (canonicalWorkflow(parsed) !== canonicalWorkflow(state.workflow)) issue(['workflow'], 'Normalized workflow does not match workflowYaml.');
  } catch (error) {
    issue(['workflowYaml'], error instanceof Error ? error.message : 'Invalid workflow YAML.');
  }
});

export function initialState(): BoardState {
  return {
    schemaVersion: DATA_VERSION,
    revision: 0,
    workflowYaml: DEFAULT_WORKFLOW_YAML,
    workflow: parseWorkflow(DEFAULT_WORKFLOW_YAML),
    projects: [], tasks: [], notes: [], settings: {},
  };
}
