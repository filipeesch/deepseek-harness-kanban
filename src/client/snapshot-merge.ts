import type { HostSnapshot, KanbanState } from '../shared/types.js';

/** A host frame merged with the board state the client holds. */
export type MergedHostSnapshot = HostSnapshot & { state: KanbanState };

/** A frame that cannot be merged without hiding a stale board. */
export class SnapshotProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProtocolError';
  }
}

/**
 * Merge one accepted host frame with the state the client already holds. A baseline must
 * carry `state`; an update omits it exactly when its revision did not change.
 */
export function mergeSnapshotFrame(previous: MergedHostSnapshot | undefined, frame: HostSnapshot, baseline: boolean): MergedHostSnapshot {
  if (frame.state !== undefined) {
    // A unary reconcile or a duplicate frame at the same revision carries identical
    // state; reuse the held object so memoized cards keep their identity. A baseline
    // always replaces the state, even when a restarted host reuses a revision.
    if (!baseline && previous !== undefined && frame.stateRevision === previous.stateRevision) return { ...frame, state: previous.state };
    return { ...frame, state: frame.state };
  }
  if (baseline) throw new SnapshotProtocolError('The Kanban baseline snapshot did not include the board state.');
  if (previous === undefined) throw new SnapshotProtocolError('The Kanban update arrived before any board state was available.');
  if (frame.stateRevision !== previous.stateRevision) throw new SnapshotProtocolError('The Kanban update changed the state revision without including the state.');
  return { ...frame, state: previous.state };
}
