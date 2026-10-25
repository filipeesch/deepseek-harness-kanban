import type { BoardState, HubState, KanbanMeta } from '../shared/types.js';
import { HubStateSchema, initialHubState } from '../domain/hub-schema.js';
import { KanbanError } from '../shared/errors.js';
import { parseWorkflow } from '../domain/workflow.js';

export const DEFAULT_HUB_ID = 'default';
export const DEFAULT_BOARD_ID = 'default-board';

export interface MigrationDeps { now: () => string }

/**
 * Map the previous single-board document into one Hub and one board.
 * The legacy document is never mutated. The board name is the workflow name
 * for a real legacy installation and `Kanban` for the untouched initial state.
 */
export function migrateLegacyState(state: BoardState, deps: MigrationDeps): { hub: HubState; meta: KanbanMeta } {
  const at = deps.now();
  const boardName = state.revision > 0 ? (state.workflow.name.trim() || 'Kanban') : 'Kanban';
  const hub = initialHubState(DEFAULT_HUB_ID, 'My Hub', at);
  hub.boards.push({
    id: DEFAULT_BOARD_ID,
    name: boardName,
    workflowYaml: state.workflowYaml,
    workflow: parseWorkflow(state.workflowYaml),
    createdAt: at,
    updatedAt: at,
  });
  hub.projects = structuredClone(state.projects);
  hub.tasks = state.tasks.map(task => ({ ...structuredClone(task), boardId: DEFAULT_BOARD_ID }));
  hub.notes = structuredClone(state.notes);
  hub.updatedAt = at;
  let parsed: HubState;
  try { parsed = HubStateSchema.parse(hub); }
  catch (error) { throw new KanbanError('MIGRATION_FAILED', 'Legacy Kanban data could not be migrated.', { cause: error instanceof Error ? error.message : String(error) }); }
  return {
    hub: parsed,
    meta: {
      initializedAt: at,
      settingsRevision: 0,
      ...(state.settings?.worktreeBasePath ? { worktreeBasePath: state.settings.worktreeBasePath } : {}),
    },
  };
}
