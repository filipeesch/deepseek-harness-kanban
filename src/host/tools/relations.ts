import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import { invariant } from '../../shared/errors.js';
import { HUB_RELATION_TYPES, type HubRelationType } from '../../shared/types.js';
import { MAX_RELATIONS_PER_WRITE } from '../../domain/card-relation.js';
import { normal } from './support.js';

/** The relation types a write may name, as the parameter schema declares them. */
const RELATION_TYPE_VALUES = [...HUB_RELATION_TYPES];

interface RelationArgument { type: HubRelationType; from: string; to: string }

/** Reject an oversized or empty collection before any lookup, so a huge batch costs nothing. */
function assertBoundedCount(value: readonly unknown[], label: string): void {
  invariant(Array.isArray(value) && value.length > 0, 'INVALID_INPUT', 'Provide at least one ' + label + '.');
  invariant(value.length <= MAX_RELATIONS_PER_WRITE, 'TOO_MANY_RELATIONS', 'At most ' + MAX_RELATIONS_PER_WRITE + ' ' + label + ' may be written in one call.');
}

export function relationTools(app: KanbanApp): ToolDefinition[] {
  return [
    normal('create_relation', 'Record relations between cards of one Hub, all or nothing. An epic relation is directed: the source is the epic and the target belongs to it, and epic relations cannot form a cycle. A related relation has no direction and is stored once for the pair. Use it when the user explicitly requests the relation, a stage instruction delivered to this conversation directs it, or a cross-card message explicitly asks for it. Never create relations merely to record the agent\'s own progress.', {
      relations: {
        type: 'array',
        required: true,
        description: 'Relations to record, at most 100 per call.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: RELATION_TYPE_VALUES, description: 'Relation type.', required: true },
            from: { type: 'string', description: 'Source task ID; the epic for the epic type.', required: true },
            to: { type: 'string', description: 'Target task ID.', required: true },
          },
        },
      },
    }, async (args) => {
      const inputs = args.relations as RelationArgument[];
      assertBoundedCount(inputs, 'relation');
      const endpoints = inputs.flatMap(input => [input.from, input.to]);
      // One pass over the Hubs resolves every endpoint of the batch.
      const located = new Map(app.hubs.locateMany(endpoints).map(entry => [entry.task.id, entry] as const));
      for (const input of inputs) {
        invariant(located.has(input.from), 'TASK_NOT_FOUND', 'The source task does not exist.');
        invariant(located.has(input.to), 'TASK_NOT_FOUND', 'The target task does not exist.');
      }
      const hubIds = new Set(inputs.flatMap(input => [located.get(input.from)!.hubId, located.get(input.to)!.hubId]));
      invariant(hubIds.size === 1, 'CROSS_HUB_RELATION', 'Every relation of one call must stay inside a single Hub.');
      const hubId = [...hubIds][0]!;
      return { relations: await app.hubs.hub(hubId).createRelations(inputs) };
    }),
    normal('delete_relation', 'Remove relations between cards by identifier, all or nothing. Use it when the user explicitly requests the removal, a stage instruction delivered to this conversation directs it, or a cross-card message explicitly asks for it.', {
      relation_ids: {
        type: 'array',
        required: true,
        description: 'Relation IDs to remove, at most 100 per call.',
        items: { type: 'string' },
      },
    }, async (args) => {
      const relationIds = [...new Set(args.relation_ids)];
      assertBoundedCount(relationIds, 'relation ID');
      const owners = app.hubs.relationOwners(relationIds);
      const unknown = relationIds.filter(relationId => !owners.has(relationId));
      invariant(unknown.length === 0, 'RELATION_NOT_FOUND', 'A relation does not exist: ' + unknown.join(', ') + '.');
      const hubs = new Set(owners.values());
      invariant(hubs.size === 1, 'CROSS_HUB_RELATION', 'Every relation of one call must belong to a single Hub.');
      return { relations: await app.hubs.hub([...hubs][0]!).deleteRelations(relationIds) };
    }),
  ];
}
