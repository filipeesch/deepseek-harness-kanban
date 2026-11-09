import type { StageSize, Workflow } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { editMapFieldInSequence, type MapFieldValues } from './yaml-map-fields.js';

/** Stage sizes keyed by stage id; a missing key means the accepted minimum size. */
export type StageSizes = Readonly<Record<string, StageSize | undefined>>;

/** The authored stage sizes of a parsed workflow, in workflow order. */
export function readStageSizes(workflow: Workflow): Record<string, StageSize> {
  const result: Record<string, StageSize> = Object.create(null) as Record<string, StageSize>;
  for (const column of workflow.columns) {
    if (column.size !== undefined) result[column.id] = { width: column.size.width, height: column.size.height };
  }
  return result;
}

function invalid(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/**
 * Rewrite only the size keys of an authored workflow document, preserving every
 * other character the author wrote. A stage with no requested size loses its
 * key; see `editMapFieldInSequence` for the guarantees.
 */
export function setStageSizes(text: string, sizes: StageSizes): string {
  const values: Record<string, MapFieldValues | undefined> = Object.create(null) as Record<string, MapFieldValues | undefined>;
  for (const [id, size] of Object.entries(sizes)) {
    values[id] = size === undefined ? undefined : { width: size.width, height: size.height };
  }
  return editMapFieldInSequence({
    text, sequenceKey: 'columns', idKey: 'id', fieldKey: 'size', values, invalid,
    render: value => 'size: {width: ' + value.width + ', height: ' + value.height + '}',
  });
}
