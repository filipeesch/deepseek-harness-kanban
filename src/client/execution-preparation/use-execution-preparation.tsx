import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClientApi, ConversationCreationOutcome, KanbanSnapshot } from '../../shared/types.js';
import { allTasks } from '../snapshot-normalize.js';
import { creationModelOutcome, creationPresetOutcome, creationReceiptId, type RunCommand } from '../ui.js';
import type { CompletePreparation, PreparationDecision, PreparationRequest, PrepareExecution } from './contract.js';
import { ExecutionPreparationController } from './controller.js';
import { ExecutionPreparationDialog } from './dialog.js';
import { PreparationRunController } from './preparation-run.js';

export interface ExecutionPreparationOptions {
  api: ClientApi;
  run: RunCommand;
  /** Report what became of the board's model and preset on the conversation this preparation created. */
  onConversationCreated?: (sessionId: string, outcome: ConversationCreationOutcome) => void;
}

export interface ExecutionPreparation {
  /** Ask the one question the move or run needs before it is applied. */
  prepare: PrepareExecution;
  /** Continue after the move: record the worktree answer and create the first conversation. */
  complete: CompletePreparation;
  dialog: React.ReactNode;
}

/**
 * Owns the first-execution preparation for one mounted board: the decision the
 * move pipeline awaits and the in-memory run that completes it after the move.
 */
export function useExecutionPreparation({ api, run, onConversationCreated }: ExecutionPreparationOptions): ExecutionPreparation {
  const [controller] = useState(() => new ExecutionPreparationController());
  const snapshot = useRef<KanbanSnapshot | null>(null);
  const latest = useRef({ api, run, onConversationCreated });
  latest.current = { api, run, onConversationCreated };
  const [runner] = useState(() => new PreparationRunController({
    createWorktree: async taskId => { await latest.current.run({ type: 'worktree.create', taskId, mode: 'new', background: true }); },
    dismissWorktree: async taskId => { await latest.current.run({ type: 'worktree.dismiss', taskId }); },
    createConversation: async taskId => {
      const result = await latest.current.run({ type: 'conversation.create', taskId, ensureFirst: true });
      const sessionId = creationReceiptId(result, 'conversation');
      if (sessionId === undefined) throw new Error('The created conversation could not be identified from its creation receipt.');
      // The preparation reports the outcomes; the conversation presents them, so the
      // move is never blocked by a model or preset fallback.
      const model = creationModelOutcome(result);
      const preset = creationPresetOutcome(result);
      latest.current.onConversationCreated?.(sessionId, { ...(model === undefined ? {} : { model }), ...(preset === undefined ? {} : { preset }) });
    },
    task: taskId => {
      const current = snapshot.current;
      return current === null ? undefined : allTasks(current).find(value => value.id === taskId);
    },
  }));

  useEffect(() => {
    // The run settles from the live projection, so a background creation reports its
    // progress without the run polling the host.
    return api.subscribe(value => {
      snapshot.current = value;
      runner.observe(allTasks(value));
    });
  }, [api, runner]);
  // Disposal is keyed on the runner alone: a changed subscription must never abandon
  // the preparations a still-mounted board owns.
  useEffect(() => () => { runner.dispose(); }, [runner]);

  const prepare = useCallback((request: PreparationRequest): Promise<PreparationDecision> => controller.open(request), [controller]);
  const complete = useCallback<CompletePreparation>((entry, worktree) => runner.start(entry, worktree), [runner]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const dialog = state.phase === 'closed' ? null : <ExecutionPreparationDialog state={state} controller={controller} />;
  return { prepare, complete, dialog };
}
