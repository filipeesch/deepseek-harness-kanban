import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { HubState, HubTask } from '../../shared/types.js';
import type { KanbanApp } from '../app.js';
import { invariant } from '../../shared/errors.js';
import { relationsOf } from '../../domain/card-relation.js';
import { UNAVAILABLE_TASK_ACTIVITY, type TaskActivity, type TaskActivityOptions, type TaskActivitySource } from '../../domain/task-activity.js';
import { compactCard, detailCard, detailRelations, directChildren, plainCard, type EpicRollup } from '../card-projection.js';
import { flag, normal, text } from './support.js';
import { requireTask, resolveBoard, taskContext, type ToolArgs } from './scope.js';

/** The largest card read a batch accepts; a larger request is truncated, not refused. */
const BATCH_CARD_LIMIT = 100;

interface CardScope { hubId: string; hub: HubState; boardId?: string }

/**
 * The scope one card listing runs in: an explicit board, an explicit Hub, or the
 * board of the calling task conversation. A pair that names both is checked, so a
 * Hub identifier can never be silently ignored. An ordinary chat that names
 * neither is rejected instead of guessing from the interface.
 */
function resolveCardScope(app: KanbanApp, args: ToolArgs, exec: Parameters<typeof taskContext>[1]): CardScope {
  if (args.hub_id !== undefined) {
    const hub = app.hubs.requireHub(args.hub_id);
    if (args.board_id === undefined) return { hubId: hub.id, hub };
    const board = hub.boards.find(value => value.id === args.board_id);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist in the selected Hub.');
    return { hubId: hub.id, hub, boardId: board.id };
  }
  if (args.board_id !== undefined) {
    const found = app.hubs.findBoard(args.board_id);
    invariant(found, 'BOARD_NOT_FOUND', 'Board does not exist.');
    return { hubId: found.hubId, hub: found.hub, boardId: found.board.id };
  }
  const located = taskContext(app, exec);
  invariant(located, 'BOARD_CONTEXT_REQUIRED', 'Pass board_id or hub_id, or use a conversation belonging to a task.');
  return { hubId: located.hubId, hub: located.hub, boardId: located.board.id };
}

/** One card's activity, or the explicit unavailable value when the host cannot be asked. */
async function readActivity(source: TaskActivitySource, task: HubTask, options?: TaskActivityOptions): Promise<TaskActivity> {
  try { return await source.activity(task, options); }
  catch { return UNAVAILABLE_TASK_ACTIVITY; }
}

async function activityByTask(source: TaskActivitySource, tasks: readonly HubTask[], options?: TaskActivityOptions): Promise<Map<string, TaskActivity>> {
  const entries = await Promise.all(tasks.map(async task => [task.id, await readActivity(source, task, options)] as const));
  return new Map(entries);
}

export function cardTools(app: KanbanApp, activity: TaskActivitySource = { activity: (task, options) => app.taskActivity(task, options) }): ToolDefinition[] {
  const intent = 'Use ONLY when the user explicitly requests this board change. Never use board cards as unsolicited internal progress tracking. This is not a TODO tool. ';
  return [
    normal('list_cards', 'Find tasks by board or by every board of a Hub, and filter by title/description, project, or workflow stage. Returns the compact card: identity, stage, worktree, activity, and relation references, without the description. Read the body with get_card.', {
      board_id: text('Board ID. Optional in a task conversation.'),
      hub_id: text('Hub ID. Lists the tasks of every board of that Hub.'),
      query: text('Case-insensitive title or description query.'),
      project_id: text('Registered project ID.'),
      workflow_state: text('Column ID.'),
      limit: { type: 'integer', description: 'Maximum results, between 1 and 200.' },
    }, async (args, exec) => {
      const scope = resolveCardScope(app, args as ToolArgs, exec);
      const query = (args.query ?? '').toLowerCase();
      const limit = args.limit ?? 50;
      invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'INVALID_LIMIT', 'limit must be between 1 and 200.');
      const tasks = scope.hub.tasks
        .filter(task => scope.boardId === undefined || task.boardId === scope.boardId)
        .filter(task => (!args.project_id || task.projectId === args.project_id)
          && (!args.workflow_state || task.columnId === args.workflow_state)
          && (!query || (task.title + ' ' + task.description).toLowerCase().includes(query)))
        // A Hub listing mixes boards and stage positions, so it is ordered by board first.
        .sort((left, right) => (scope.boardId === undefined ? left.boardId.localeCompare(right.boardId) : 0) || left.position - right.position)
        .slice(0, limit);
      const activities = await activityByTask(activity, tasks, { wait: false });
      return tasks.map(task => compactCard({
        task,
        hubId: scope.hubId,
        relations: relationsOf(scope.hub, task.id),
        activity: activities.get(task.id) ?? UNAVAILABLE_TASK_ACTIVITY,
      }));
    }, true),
    normal('get_card', 'Read one task in full: its description, project, board and Hub, its relations with the other card, its activity, and the direct children of an epic. The description and the epic roll-up are only available through this read.', {
      task_id: text('Task ID. Optional in a task conversation.'),
    }, async (args, exec) => {
      const located = requireTask(app, args as ToolArgs, exec);
      const { task, hub, hubId } = located;
      const relations = relationsOf(hub, task.id);
      const children = directChildren(hub, task.id);
      // The card's own activity is a durable read; each child is read from the facts the
      // host already resolved, so a large roll-up never waits on that many native reads.
      const [ownActivity, childActivities] = await Promise.all([
        readActivity(activity, task, { wait: true }),
        activityByTask(activity, children.tasks, { wait: false }),
      ]);
      const epicRollup: EpicRollup | undefined = children.total === 0 ? undefined : {
        children: children.tasks.map(child => ({
          id: child.id,
          title: child.title,
          columnId: child.columnId,
          activity: childActivities.get(child.id) ?? UNAVAILABLE_TASK_ACTIVITY,
        })),
        total: children.total,
        truncated: children.truncated,
      };
      return detailCard({
        task,
        hubId,
        hubName: hub.name,
        project: located.project,
        board: located.board,
        relations,
        activity: ownActivity,
        relationDetails: detailRelations(hub, relations, task.id),
        ...(epicRollup === undefined ? {} : { epicRollup }),
      });
    }, true),
    normal('get_cards', 'Read several cards in one call with the compact payload. Missing identifiers are reported separately, and a request above the batch limit is truncated explicitly with the identifiers it dropped.', {
      task_ids: { type: 'array', items: { type: 'string' }, description: 'Task IDs to read.', required: true },
    }, async (args) => {
      const requested = [...new Set(args.task_ids.map(value => value.trim()))].filter(value => value.length > 0);
      invariant(requested.length > 0, 'INVALID_INPUT', 'Provide at least one task ID.');
      const bounded = requested.slice(0, BATCH_CARD_LIMIT);
      const dropped = requested.slice(BATCH_CARD_LIMIT);
      // One pass over the Hubs resolves the whole batch, so a hundred identifiers do not
      // clone a Hub a hundred times.
      const located = new Map(app.hubs.locateMany(bounded).map(entry => [entry.task.id, entry] as const));
      const missing = bounded.filter(taskId => !located.has(taskId));
      const cards = bounded.flatMap(taskId => located.get(taskId) ?? []);
      const activities = await activityByTask(activity, cards.map(entry => entry.task), { wait: false });
      return {
        cards: cards.map(entry => compactCard({
          task: entry.task,
          hubId: entry.hubId,
          relations: relationsOf(entry.hub, entry.task.id),
          activity: activities.get(entry.task.id) ?? UNAVAILABLE_TASK_ACTIVITY,
        })),
        missing,
        truncated: dropped.length > 0,
        ...(dropped.length === 0 ? {} : { dropped }),
      };
    }, true),
    normal('create_card', intent + 'Create in the board\'s initial column. When that stage has an entry instruction, prepare the first execution and dispatch its instruction in the same call; use auto_mode to enable automatic advance after completed turns. Use list_hubs, list_boards, and list_projects to select scope.', {
      board_id: text('Board ID. Optional in a task conversation.'),
      project_id: text('Registered project ID from the board\'s Hub.', true),
      title: text('Task title.', true),
      description: text('Markdown task description.'),
      auto_mode: flag('Enable automatic stage advance for the created task.'),
    }, async (args, exec) => {
      const { board, hub } = resolveBoard(app, args as ToolArgs, exec);
      const { task: current, firstExecution } = await app.createTaskAndStart({
        boardId: board.id,
        projectId: args.project_id,
        title: args.title,
        description: args.description ?? '',
        ...(args.auto_mode === true ? { autoMode: true } : {}),
      }, true);
      return { ...plainCard(current), hubId: hub.id, firstExecution };
    }),
    normal('edit_card', intent + 'Edit title/description at any stage without messaging or starting task conversations.', {
      task_id: text('Task ID. Optional in a task conversation.'),
      title: text('Replacement title.'),
      description: text('Replacement Markdown description.'),
    }, async (args, exec) => {
      const located = requireTask(app, args as ToolArgs, exec);
      invariant(args.title !== undefined || args.description !== undefined, 'INVALID_EDIT', 'Provide title or description.');
      await app.command({
        type: 'task.edit', hubId: located.hubId, taskId: located.task.id,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
      });
      return { ...plainCard(app.hubs.requireTask(located.task.id).task), hubId: located.hubId };
    }),
  ];
}
