import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ClientApi, ConversationModelOutcome } from '../../shared/types.js';
import { ConversationLeaseRegistry, type ConversationLeaseEnvironment } from '../conversation-leases.js';
import { creationModelOutcome, creationReceiptId, type RunCommand } from '../ui.js';
import type { PrepareExecution, PreparationRequest } from './contract.js';
import { ExecutionPreparationController } from './controller.js';
import { ExecutionPreparationDialog } from './dialog.js';
import { MODEL_SELECTION_SLOT, type PreparationSeat } from './model-seat.js';

export interface ExecutionPreparationOptions {
  api: ClientApi;
  run: RunCommand;
  /** The native slots and locale; absent in isolated render harnesses. */
  seat?: PreparationSeat;
  /** The client session services; absent in isolated render harnesses. */
  leases?: ConversationLeaseEnvironment;
  /** Report what became of the board's model on the conversation this preparation created. */
  onConversationCreated?: (sessionId: string, outcome: ConversationModelOutcome | undefined) => void;
}

export interface ExecutionPreparation {
  prepare: PrepareExecution;
  dialog: React.ReactNode;
}

function retained(registry: ConversationLeaseRegistry | null, sessionId: string, signal: AbortSignal | undefined): Promise<void> {
  if (registry === null) return Promise.reject(new Error('No native session environment is available.'));
  const leases = registry;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => {};
    function cleanup(): void { unsubscribe(); signal?.removeEventListener('abort', aborted); }
    function aborted(): void {
      if (settled) return;
      settled = true; cleanup();
      reject(new Error('The board closed before the conversation could be retained.'));
    }
    function finish(): void {
      if (settled) return;
      const state = leases.getSnapshot()[sessionId];
      if (state === undefined) return;
      if (state.status === 'ready') { settled = true; cleanup(); resolve(); }
      else if (state.status === 'error') { settled = true; cleanup(); reject(new Error(state.error ?? 'The conversation could not be retained.')); }
    }
    if (signal?.aborted) { reject(new Error('The board closed before the conversation could be retained.')); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    unsubscribe = leases.subscribe(finish);
    finish();
    leases.acquireRoot(sessionId);
    finish();
  });
}

/**
 * Owns the first-execution preparation for one mounted board: the controller,
 * the session lease used by the native model seat, and the dialog element.
 */
export function useExecutionPreparation({ api, run, seat, leases, onConversationCreated }: ExecutionPreparationOptions): ExecutionPreparation {
  const [controller] = useState(() => new ExecutionPreparationController());
  const registry = useMemo(() => leases === undefined ? null : new ConversationLeaseRegistry(leases), [leases]);
  useEffect(() => () => { registry?.dispose(); }, [registry]);
  const [seatAvailable, setSeatAvailable] = useState(false);
  useEffect(() => {
    if (seat === undefined) { setSeatAvailable(false); return; }
    const update = (): void => setSeatAvailable(seat.slots.entriesOfSlot(MODEL_SELECTION_SLOT).length > 0);
    update();
    return seat.slots.subscribe(MODEL_SELECTION_SLOT, update);
  }, [seat]);
  const latest = useRef({ api, run, registry, seatAvailable, lifetime: leases?.lifetime, onConversationCreated });
  latest.current = { api, run, registry, seatAvailable, lifetime: leases?.lifetime, onConversationCreated };

  useEffect(() => {
    controller.configure({
      defaults: taskId => latest.current.api.worktreeDefault(taskId),
      createWorktree: async (taskId, draft) => { await latest.current.run({ type: 'worktree.create', taskId, ...draft }); },
      dismissWorktree: async taskId => { await latest.current.run({ type: 'worktree.dismiss', taskId }); },
      createConversation: async taskId => {
        const result = await latest.current.run({ type: 'conversation.create', taskId });
        const sessionId = creationReceiptId(result, 'conversation');
        if (sessionId === undefined) throw new Error('The created conversation could not be identified from its creation receipt.');
        // The preparation itself is not the place to announce a fallback: it reports
        // the outcome and the conversation presents it, so the move is never blocked.
        latest.current.onConversationCreated?.(sessionId, creationModelOutcome(result));
        return sessionId;
      },
      retainSession: sessionId => retained(latest.current.registry, sessionId, latest.current.lifetime),
      releaseSession: sessionId => latest.current.registry?.release(sessionId),
      seatAvailable: () => latest.current.registry !== null && latest.current.seatAvailable,
      modelCatalog: async () => {
        try { return await latest.current.api.modelCatalog(false); }
        catch { return null; }
      },
    });
  }, [controller]);

  const prepare = useCallback((request: PreparationRequest): Promise<boolean> => controller.open(request), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const dialog = state.phase === 'closed' ? null : <ExecutionPreparationDialog state={state} controller={controller} seat={seat} />;
  return { prepare, dialog };
}
