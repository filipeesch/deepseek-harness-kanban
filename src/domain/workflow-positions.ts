import type { StagePosition, Workflow } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { editMapFieldInSequence, type MapFieldValues } from './yaml-map-fields.js';

/** Stage placements keyed by stage id; a missing key means automatic placement. */
export type StagePositions = Readonly<Record<string, StagePosition | undefined>>;

/** The authored placements of a parsed workflow, in workflow order. */
export function readStagePositions(workflow: Workflow): Record<string, StagePosition> {
  // A stage id can be any safe identifier, including inherited names like `toString`.
  const result: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
  for (const column of workflow.columns) {
    if (column.position !== undefined) result[column.id] = { x: column.position.x, y: column.position.y };
  }
  return result;
}

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/**
 * Rewrite only the position keys of an authored workflow document, preserving
 * every other character the author wrote. A stage with no requested position
 * loses its key; see `editMapFieldInSequence` for the guarantees.
 */
export function setStagePositions(text: string, positions: StagePositions): string {
  const values: Record<string, MapFieldValues | undefined> = Object.create(null) as Record<string, MapFieldValues | undefined>;
  for (const [id, position] of Object.entries(positions)) {
    values[id] = position === undefined ? undefined : { x: position.x, y: position.y };
  }
  return editMapFieldInSequence({
    text, sequenceKey: 'columns', idKey: 'id', fieldKey: 'position', values, invalid,
    render: value => 'position: {x: ' + value.x + ', y: ' + value.y + '}',
  });
}
