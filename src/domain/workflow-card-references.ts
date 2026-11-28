import type { HubState } from '../shared/types.js';
import { ownsScriptedEntry } from './scripted-state.js';
import type { WorkflowCardReference } from './workflow-report.js';

/**
 * The task references a workflow report needs, projected from one Hub snapshot.
 *
 * Identities and facts only: a title, description, message, or parameter value never
 * enters a report. The projection reads the snapshot whose revision a preview quotes,
 * so a card created or moved during a later await cannot appear in the reviewed
 * impact; the same function serves both a write report and a preview.
 */
export function workflowCardReferences(hub: Pick<HubState, 'tasks'>, boardId: string): WorkflowCardReference[] {
  return hub.tasks.filter(task => task.boardId === boardId).map(task => ({
    id: task.id,
    columnId: task.columnId,
    ...(task.recordedTransition === undefined ? {} : {
      recordedTransition: {
        fromColumnId: task.recordedTransition.fromColumnId,
        columnId: task.recordedTransition.columnId,
        ...(task.recordedTransition.exception === undefined ? {} : { exception: true as const }),
      },
    }),
    ...(task.pendingTransition === undefined ? {} : {
      pendingTransition: {
        fromColumnId: task.pendingTransition.fromColumnId,
        columnId: task.pendingTransition.columnId,
        ...(task.pendingTransition.transitionOverride === true ? { transitionOverride: true as const } : {}),
      },
    }),
    ...(ownsScriptedEntry(task) ? { scriptedEntry: true as const } : {}),
    // Parameter names only: a report never carries an entry's values.
    parameters: [...new Set([
      ...Object.keys(task.scripted?.parameters ?? {}),
      ...Object.keys(task.recordedTransition?.parameters ?? {}),
      ...Object.keys(task.pendingTransition?.parameters ?? {}),
    ])],
  }));
}
