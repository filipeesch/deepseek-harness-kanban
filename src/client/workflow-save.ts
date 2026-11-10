import { useCallback } from 'react';
import type { Command, KanbanSnapshot } from '../shared/types.js';
import { useAction, type RunCommand } from './ui.js';

/** The workflow writes both editors send: one stage patch or one whole document. */
export type WorkflowSaveCommand = Extract<Command, { type: 'board.workflow.save' | 'board.stage.update' }>;

/** The Hub revision one command response reports; the next write targets it. */
export function hubRevisionOf(snapshot: KanbanSnapshot | undefined, hubId: string): number | undefined {
  return snapshot?.state?.hubs.find(hub => hub.id === hubId)?.revision;
}

/**
 * The one saver the workflow editors share. It sends a workflow write, remembers the
 * revision the host reported so a later write can target it, and exposes the pending
 * flag and the inline problem each editor renders. It owns no draft: the caller
 * decides what to send and what to do with the answer.
 */
export function useWorkflowSave(run: RunCommand) {
  const action = useAction(run);
  const save = useCallback(async (command: WorkflowSaveCommand) => action.execute(command), [action]);
  return { pending: action.pending, error: action.error, clearError: action.clearError, save };
}
