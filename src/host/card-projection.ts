import type { Board, HubRelation, HubState, HubTask, Project } from '../shared/types.js';
import type { TaskActivity } from '../domain/task-activity.js';
import { EPIC_ROLLUP_LIMIT, epicChildren, otherEndpoint, relationReference, type RelationReference } from '../domain/card-relation.js';

/**
 * The one place a card payload is shaped. Two shapes exist so a listing stays
 * cheap and a detail read stays complete; both exclude the flow record and the
 * deterministic ledger, which the drawer owns.
 */

/** The stored task without the fields a tool payload never carries. */
export function plainCard(task: HubTask): Omit<HubTask, 'history' | 'deterministic'> {
  const { history: _history, deterministic: _ledger, ...rest } = task;
  return rest;
}

export interface CompactCardInput {
  task: HubTask;
  hubId: string;
  relations: readonly HubRelation[];
  activity: TaskActivity;
}

/** The listing payload: no description, relation references, and activity. */
export function compactCard(input: CompactCardInput): Record<string, unknown> {
  const { description: _description, ...fields } = plainCard(input.task);
  return {
    ...fields,
    hubId: input.hubId,
    activity: input.activity,
    relations: input.relations.map(relation => relationReference(relation, input.task.id)),
  };
}

/** One relation as a detail read reports it: the reference plus the other card. */
export interface DetailRelation extends RelationReference {
  otherTitle?: string;
  otherColumnId?: string;
}

/** One direct child of an epic in the roll-up. */
export interface EpicRollupChild {
  id: string;
  title: string;
  columnId: string;
  activity: TaskActivity;
}

/** The bounded roll-up of a card's direct children. */
export interface EpicRollup {
  children: EpicRollupChild[];
  total: number;
  truncated: boolean;
}

export interface DetailCardInput {
  task: HubTask;
  hubId: string;
  hubName: string;
  project: Project;
  board: Board;
  relations: readonly HubRelation[];
  activity: TaskActivity;
  relationDetails: readonly DetailRelation[];
  epicRollup?: EpicRollup;
}

/** The detail payload: the compact card plus its context, description, and relations. */
export function detailCard(input: DetailCardInput): Record<string, unknown> {
  return {
    ...compactCard(input),
    description: input.task.description,
    project: input.project,
    board: { id: input.board.id, name: input.board.name },
    hub: { id: input.hubId, name: input.hubName },
    relations: input.relationDetails,
    ...(input.epicRollup === undefined ? {} : { epicRollup: input.epicRollup }),
  };
}

/** The relations of one card with the other endpoint's title and stage, when it exists. */
export function detailRelations(hub: HubState, relations: readonly HubRelation[], taskId: string): DetailRelation[] {
  return relations.map(relation => {
    const reference = relationReference(relation, taskId);
    const other = hub.tasks.find(task => task.id === reference.otherTaskId);
    return other === undefined
      ? reference
      : { ...reference, otherTitle: other.title, otherColumnId: other.columnId };
  });
}

/** The direct children of one epic, bounded, with the total and the truncation signal. */
export function directChildren(hub: HubState, taskId: string, limit = EPIC_ROLLUP_LIMIT): { tasks: HubTask[]; total: number; truncated: boolean } {
  const children = epicChildren(hub, taskId);
  const tasks = children
    .map(relation => hub.tasks.find(task => task.id === otherEndpoint(relation, taskId)))
    .filter((task): task is HubTask => task !== undefined);
  return { tasks: tasks.slice(0, limit), total: tasks.length, truncated: tasks.length > limit };
}
