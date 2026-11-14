import type { BoardRelation, HubRelationType } from '../../shared/types.js';
import { relationDirection, type RelationDirection } from '../../domain/card-relation.js';

export type RelationKind = HubRelationType;

/** One relation as the Relations section reads it. */
export interface RelationRow {
  key: string;
  kind: RelationKind;
  direction: RelationDirection;
  /** The sentence naming the relation and the card at the other end. */
  label: string;
  /** The other card's stage, already resolved to its name. */
  stage: string | undefined;
  /** The other card's board, present only when it lives on another board. */
  board: string | undefined;
}

const EMPTY_LABEL = 'Untitled card';

/**
 * The rows the Relations section shows for one task: never the relation of another
 * pair, and always naming the card at the other end even when it lives elsewhere.
 * Outgoing relations come first, then incoming, then the ones with no direction.
 */
export function buildRelationRows(input: {
  taskId: string;
  taskBoardId: string;
  relations: readonly BoardRelation[];
}): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const relation of input.relations) {
    if (relation.from !== input.taskId && relation.to !== input.taskId) continue;
    const outgoing = relation.from === input.taskId;
    const otherTitle = (outgoing ? relation.toTitle : relation.fromTitle) ?? EMPTY_LABEL;
    const direction = relationDirection(relation, input.taskId);
    rows.push({
      key: relation.id,
      kind: relation.type,
      direction,
      label: relation.type === 'related' ? 'Related to ' + otherTitle : outgoing ? 'Epic of ' + otherTitle : 'Belongs to epic ' + otherTitle,
      stage: outgoing ? relation.toStageName : relation.fromStageName,
      board: (outgoing ? relation.toBoardId : relation.fromBoardId) === input.taskBoardId ? undefined : (outgoing ? relation.toBoardName : relation.fromBoardName),
    });
  }
  const rank: Record<RelationDirection, number> = { outgoing: 0, incoming: 1, symmetric: 2 };
  return rows.sort((left, right) => rank[left.direction] - rank[right.direction]);
}
