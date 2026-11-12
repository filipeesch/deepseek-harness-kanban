import type { BoardChange } from './event.js';
import type { SharingChangeSummary } from '../../shared/types.js';
export type { SharingChangeSummary };

/** Map a derived batch to the summaries the interface shows. */
export function summarizeChanges(changes: readonly BoardChange[]): SharingChangeSummary[] {
  return changes.map(change => {
    switch (change.kind) {
      case 'workflow.replaced': return { kind: change.kind };
      case 'workflow.field-changed': return { kind: change.kind, field: change.field };
      case 'workflow.initial-changed': return { kind: change.kind, columnId: change.columnId };
      case 'stage.created': return { kind: change.kind, id: change.stage.id, name: change.stage.name };
      case 'stage.field-changed': return { kind: change.kind, stage: change.key, field: change.field };
      case 'stage.id-changed': return { kind: change.kind, from: change.from, to: change.id };
      case 'stage.removed': return { kind: change.kind, stage: change.key };
      case 'stage.layout-set': return { kind: change.kind, stage: change.key };
      case 'group.created': return { kind: change.kind, id: change.group.id, name: change.group.name };
      case 'group.field-changed': return { kind: change.kind, id: change.id, field: change.field };
      case 'group.removed': return { kind: change.kind, id: change.id };
      case 'connection.set': return { kind: change.kind, from: change.layout.from, to: change.layout.to };
      case 'connection.removed': return { kind: change.kind, from: change.from, to: change.to };
      case 'board.renamed': return { kind: change.kind, name: change.name };
      case 'board.scope-changed': return { kind: change.kind, projects: change.projectKeys === null ? 0 : change.projectKeys.length, closed: change.projectKeys?.length === 0 };
      case 'board.rank-changed': return { kind: change.kind };
      case 'board.removed': return { kind: change.kind };
    }
  });
}