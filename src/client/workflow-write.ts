import { useCallback, useMemo, useRef } from 'react';
import type { KanbanSnapshot, StagePatch } from '../shared/types.js';
import { hubRevisionOf } from './workflow-save.js';
import type { RunCommand } from './ui.js';

/**
 * Ordering and revision bookkeeping for a board's workflow writes.
 *
 * Two writers reach the same document: the coalesced layout save and the
 * per-stage patch. A step that changes both must not interleave with a third
 * write, and the revision a write targets must be the one the previous write
 * acknowledged. This port owns exactly those two facts and nothing else.
 */
export interface WorkflowWriteQueue {
  /** The revision the next write targets. */
  readonly revision: () => number;
  /** The authored document the last acknowledged write reported, when it reported one. */
  readonly acknowledgedYaml: () => string | null;
  setAcknowledgedYaml(yaml: string | null): void;
  /** Run one write after every write queued before it. A failed write does not block the next. */
  write<T>(task: () => Promise<T>): Promise<T>;
  /** Adopt a revision a response reported; a lower value never moves the target backwards. */
  adopt(revision: number | undefined): void;
  /** Resolves when nothing is queued or in flight. */
  drain(): Promise<void>;
}

/** One board's write queue, seeded with the revision the board currently reports. */
export function workflowWriteQueue(revision: number): WorkflowWriteQueue {
  let targeted = revision;
  let acknowledged: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    revision: () => targeted,
    acknowledgedYaml: () => acknowledged,
    setAcknowledgedYaml(yaml) { acknowledged = yaml; },
    adopt(next) {
      if (typeof next === 'number' && Number.isFinite(next) && next > targeted) targeted = next;
    },
    write(task) {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    drain() {
      return tail.then(() => undefined, () => undefined);
    },
  };
}

/** One write performed inside a reserved slot. */
export interface WorkflowSend {
  saveWorkflow(yaml: string): Promise<KanbanSnapshot>;
  patchStage(stageId: string, patch: StagePatch): Promise<KanbanSnapshot>;
}

/** The workflow writes the diagram makes, in the order it makes them. */
export interface WorkflowWrites extends WorkflowSend {
  /**
   * Store a layout edit, composed inside the slot against the document the previous write
   * acknowledged. The composition has to happen there: a document captured before the
   * slot could carry transitions a stage patch already replaced.
   */
  saveLayout(compose: (acknowledged: string | null) => string | null): Promise<KanbanSnapshot | null>;
  /**
   * Run several writes in one reserved slot, so no other workflow write runs between
   * them. A gesture that authors one stage and prunes another's layout entry needs it:
   * an interleaved save would otherwise store a document between the two halves.
   */
  atomically<T>(task: (send: WorkflowSend) => Promise<T>): Promise<T>;
  /** Resolves when every queued write has settled. */
  drain(): Promise<void>;
}

export interface WorkflowWritesInput {
  readonly hubId: string;
  readonly boardId: string;
  readonly run: RunCommand;
  /** The revision the board reports; every render keeps the queue targeting it. */
  readonly revision: number;
}

/**
 * The one writer the diagram uses. Both commands go through the same queue, so a
 * gesture that needs a stage patch and a document save stores them in the order
 * it asks for them instead of racing on the revision.
 */
export function useWorkflowWrites(input: WorkflowWritesInput): WorkflowWrites {
  // The scope is memoized per board, so a write a view scheduled while it was showing
  // one board keeps targeting that board even if the presentation is handed another one.
  // The revision is Hub-scoped, so the newest one the presentation reports applies to
  // every board of that Hub, including a write a previous board already scheduled.
  const revision = useRef(input.revision); revision.current = input.revision;
  const state = useMemo(() => ({ queue: workflowWriteQueue(input.revision), hubId: input.hubId, boardId: input.boardId }), [input.boardId, input.hubId]);
  state.queue.adopt(input.revision);
  const run = useRef(input.run); run.current = input.run;

  /** The writes of one slot. They run in the order the caller awaits them. */
  const acknowledgedYamlOf = (snapshot: KanbanSnapshot, hubId: string, boardId: string): string | null =>
    snapshot.state.hubs.find(hub => hub.id === hubId)?.boards.find(board => board.id === boardId)?.workflowYaml ?? null;

  const sendFor = useCallback((scope: { queue: WorkflowWriteQueue; hubId: string; boardId: string }): WorkflowSend => ({
    async saveWorkflow(yaml: string) {
      scope.queue.adopt(revision.current);
      const result = await run.current({ type: 'board.workflow.save', hubId: scope.hubId, boardId: scope.boardId, yaml, expectedRevision: scope.queue.revision() });
      scope.queue.adopt(hubRevisionOf(result, scope.hubId));
      scope.queue.setAcknowledgedYaml(acknowledgedYamlOf(result, scope.hubId, scope.boardId));
      return result;
    },
    async patchStage(stageId: string, patch: StagePatch) {
      scope.queue.adopt(revision.current);
      const result = await run.current({ type: 'board.stage.update', hubId: scope.hubId, boardId: scope.boardId, stageId, patch, expectedRevision: scope.queue.revision() });
      scope.queue.adopt(hubRevisionOf(result, scope.hubId));
      scope.queue.setAcknowledgedYaml(acknowledgedYamlOf(result, scope.hubId, scope.boardId));
      return result;
    },
  }), []);

  const saveWorkflow = useCallback(async (yaml: string): Promise<KanbanSnapshot> => {
    if (state.hubId.length === 0) throw new Error('A workflow write needs a Hub.');
    const send = sendFor(state);
    return state.queue.write(() => send.saveWorkflow(yaml));
  }, [sendFor, state]);

  const patchStage = useCallback(async (stageId: string, patch: StagePatch): Promise<KanbanSnapshot> => {
    if (state.hubId.length === 0) throw new Error('A workflow write needs a Hub.');
    const send = sendFor(state);
    return state.queue.write(() => send.patchStage(stageId, patch));
  }, [sendFor, state]);

  const saveLayout = useCallback((compose: (acknowledged: string | null) => string | null): Promise<KanbanSnapshot | null> => {
    if (state.hubId.length === 0) return Promise.reject(new Error('A workflow write needs a Hub.'));
    const send = sendFor(state);
    return state.queue.write(async () => {
      const text = compose(state.queue.acknowledgedYaml());
      if (text === null) return null;
      return send.saveWorkflow(text);
    });
  }, [sendFor, state]);

  const atomically = useCallback(<T,>(task: (send: WorkflowSend) => Promise<T>): Promise<T> => {
    if (state.hubId.length === 0) return Promise.reject(new Error('A workflow write needs a Hub.'));
    const send = sendFor(state);
    return state.queue.write(() => task(send));
  }, [sendFor, state]);

  const drain = useCallback(() => state.queue.drain(), [state]);

  return useMemo(() => ({ saveWorkflow, patchStage, saveLayout, atomically, drain }), [atomically, drain, patchStage, saveLayout, saveWorkflow]);
}
