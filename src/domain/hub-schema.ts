import { z } from 'zod';
import type { Board, HubState, HubTask, KanbanMeta, KanbanSettings } from '../shared/types.js';
import { DEFAULT_WORKFLOW_YAML, parseWorkflow } from './workflow.js';
import { absolutePath, baseTask, canonicalWorkflow, createTaskInvariantChecker, id, nonempty, note, project, revision, timestamp, workflow } from './schema-parts.js';

export { canonicalWorkflow } from './schema-parts.js';

const board = z.strictObject({
  id, name: nonempty, workflowYaml: nonempty, workflow, createdAt: timestamp, updatedAt: timestamp,
});
const task = baseTask.extend({ boardId: id });

/** Persisted settings and initialization marker stored in the domain global slot. */
export const KanbanMetaSchema: z.ZodType<KanbanMeta> = z.strictObject({
  initializedAt: timestamp.optional(),
  settingsRevision: revision,
  worktreeBasePath: absolutePath.optional(),
});

/** Global user settings exposed to the client. */
export const KanbanSettingsSchema: z.ZodType<KanbanSettings> = z.strictObject({
  revision,
  worktreeBasePath: absolutePath.optional(),
});

/** Validates one Hub aggregate. Cross-Hub ownership is enforced by the repository. */
export const HubStateSchema: z.ZodType<HubState> = z.strictObject({
  id, name: nonempty, revision, projects: z.array(project), boards: z.array(board), tasks: z.array(task), notes: z.array(note), createdAt: timestamp, updatedAt: timestamp,
}).superRefine((state, context) => {
  const issue = (path: (string | number)[], message: string): void => { context.addIssue({ code: 'custom', path, message }); };
  const unique = (values: string[], path: (string | number)[]): void => {
    if (new Set(values).size !== values.length) issue(path, 'Identifiers must be unique.');
  };
  unique(state.projects.map(value => value.id), ['projects']);
  unique(state.boards.map(value => value.id), ['boards']);
  unique(state.tasks.map(value => value.id), ['tasks']);
  unique(state.notes.map(value => value.id), ['notes']);
  const boardNames = state.boards.map(value => value.name.trim().toLocaleLowerCase());
  if (new Set(boardNames).size !== boardNames.length) issue(['boards'], 'Board names must be unique within a Hub.');
  const projectIds = new Set(state.projects.map(value => value.id));
  const taskIds = new Set(state.tasks.map(value => value.id));
  const boardById = new Map(state.boards.map(value => [value.id, value]));
  for (const [index, value] of state.boards.entries()) {
    unique(value.workflow.columns.map(item => item.id), ['boards', index, 'workflow', 'columns']);
    unique(value.workflow.groups.map(item => item.id), ['boards', index, 'workflow', 'groups']);
    if (!value.workflow.columns.some(item => item.id === value.workflow.initialColumnId)) issue(['boards', index, 'workflow', 'initialColumnId'], 'Initial column must exist.');
    try {
      const parsed = parseWorkflow(value.workflowYaml);
      if (canonicalWorkflow(parsed) !== canonicalWorkflow(value.workflow)) issue(['boards', index, 'workflow'], 'Normalized workflow does not match workflowYaml.');
    } catch (error) {
      issue(['boards', index, 'workflowYaml'], error instanceof Error ? error.message : 'Invalid workflow YAML.');
    }
  }
  const checker = createTaskInvariantChecker(projectIds, issue);
  for (const [index, value] of state.tasks.entries()) {
    const owner = boardById.get(value.boardId);
    if (!owner) { issue(['tasks', index, 'boardId'], 'Task board does not exist.'); continue; }
    const columnIds = new Set(owner.workflow.columns.map(item => item.id));
    checker.check(value, index, columnIds, 'Task column does not exist in its board.');
  }
  for (const [index, value] of state.notes.entries()) {
    if (!taskIds.has(value.taskId)) issue(['notes', index, 'taskId'], 'Note task does not exist.');
  }
});

/** The client-facing aggregate of all Hubs plus global settings. */
export const KanbanStateSchema = z.strictObject({
  hubs: z.array(HubStateSchema),
  settings: KanbanSettingsSchema,
});

export function createBoard(idValue: string, name: string, now: string, workflowYaml = DEFAULT_WORKFLOW_YAML): Board {
  return { id: idValue, name, workflowYaml, workflow: parseWorkflow(workflowYaml), createdAt: now, updatedAt: now };
}

export function initialHubState(idValue: string, name: string, now = new Date().toISOString()): HubState {
  return { id: idValue, name, revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now };
}

export function defaultHubState(idValue: string, name: string, boardId: string, boardName: string, now = new Date().toISOString()): HubState {
  const hub = initialHubState(idValue, name, now);
  hub.boards.push(createBoard(boardId, boardName, now));
  return hub;
}

/** A HubTask is a Task with its required board identity; the persisted schema enforces it. */
export type { HubTask };
