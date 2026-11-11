import { useCallback, useEffect, useRef } from 'react';
import type { ConnectionLayout, StagePosition, StageSize, Workflow } from '../../../shared/types.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../../../domain/workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from '../../../domain/workflow-sizes.js';
import { readConnections, setConnections, type ConnectionLayouts } from '../../../domain/workflow-connections.js';

/** How long a layout edit waits before it stores the workflow; one edit, one save. */
export const PLACEMENT_SAVE_DELAY_MS = 400;

export interface PlacementSaver {
  /** The placement this view intends to persist; edits compose against it. */
  readonly desiredPositions: React.MutableRefObject<Record<string, StagePosition>>;
  /** The sizes this view intends to persist. */
  readonly desiredSizes: React.MutableRefObject<Record<string, StageSize>>;
  /** The connection layout this view intends to persist. */
  readonly desiredConnections: React.MutableRefObject<Record<string, ConnectionLayout>>;
  intendPositions(positions: StagePositions): void;
  intendSizes(sizes: StageSizes): void;
  intendConnections(connections: ConnectionLayouts): void;
  /** Adopt the values a transaction already stored, so they are not sent again. */
  acceptConnections(connections: ConnectionLayouts): void;
  queueSave(): void;
  saveNow(): void;
  /** Store every pending layout edit and resolve once the newest text is stored. */
  flush(): Promise<void>;
  /** Apply the intended layout to the given authored text. */
  writeInto(text: string): string;
  cancelTimer(): void;
}

function positionRecord(positions: StagePositions): Record<string, StagePosition> {
  const next: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
  for (const [id, position] of Object.entries(positions)) if (position !== undefined) next[id] = { x: position.x, y: position.y };
  return next;
}

function sizeRecord(sizes: StageSizes): Record<string, StageSize> {
  const next: Record<string, StageSize> = Object.create(null) as Record<string, StageSize>;
  for (const [id, size] of Object.entries(sizes)) if (size !== undefined) next[id] = { width: size.width, height: size.height };
  return next;
}

function connectionRecord(connections: ConnectionLayouts): Record<string, ConnectionLayout> {
  const next: Record<string, ConnectionLayout> = Object.create(null) as Record<string, ConnectionLayout>;
  for (const [id, layout] of Object.entries(connections)) if (layout !== undefined) next[id] = layout;
  return next;
}

function readLayout(workflow: Workflow): LayoutValues {
  return { positions: readStagePositions(workflow), sizes: readStageSizes(workflow), connections: readConnections(workflow) };
}

function writeLayout(text: string, values: LayoutValues): string {
  return setConnections(setStageSizes(setStagePositions(text, values.positions), values.sizes), values.connections);
}

/** One layout as the view intends it: every field at once. */
interface LayoutValues {
  readonly positions: Record<string, StagePosition>;
  readonly sizes: Record<string, StageSize>;
  readonly connections: Record<string, ConnectionLayout>;
}

export interface PlacementSaverInput {
  readonly boardId: string;
  /**
   * Store a layout edit. The writer composes inside its own slot, against the document
   * the previous write acknowledged, so a document captured here could never carry
   * transitions a stage patch already replaced.
   */
  readonly saveLayout: (compose: (acknowledged: string | null) => string | null) => Promise<unknown>;
  readonly workflow: Workflow;
  readonly workflowYaml: string;
  readonly onError: (error: unknown) => void;
  /** Called after a rejected save reset the intended layout to the acknowledged one. */
  readonly onRejected?: () => void;
}

/**
 * The coalesced workflow save for layout edits.
 *
 * The intended *values* are the source of truth, not a captured document: the document
 * is composed inside the writer's slot against the newest acknowledged workflow, so a
 * pending stage patch can never be reverted by a layout save that was queued before it.
 * A save in flight coalesces the next one, a rejected save returns everything to the
 * acknowledged workflow, and a completed edit is flushed before unmount.
 */
export function usePlacementSaver(input: PlacementSaverInput): PlacementSaver {
  const inputRef = useRef(input); inputRef.current = input;
  /**
   * The board and the writer a pending edit belongs to. A layout edit must be stored on
   * the board that authored it, with the document that board acknowledged, even if the
   * presentation is handed another board before the save runs.
   */
  const owner = useRef({ boardId: input.boardId, saveLayout: input.saveLayout, workflowYaml: input.workflowYaml });
  const acknowledgedRef = useRef({ workflow: input.workflow, workflowYaml: input.workflowYaml });
  const errorRef = useRef(input.onError); errorRef.current = input.onError;
  const rejectedRef = useRef(input.onRejected); rejectedRef.current = input.onRejected;

  const desiredPositions = useRef<Record<string, StagePosition>>(Object.create(null) as Record<string, StagePosition>);
  const desiredSizes = useRef<Record<string, StageSize>>(Object.create(null) as Record<string, StageSize>);
  const desiredConnections = useRef<Record<string, ConnectionLayout>>(Object.create(null) as Record<string, ConnectionLayout>);
  const boardRef = useRef(input.boardId);
  /** True while the intended values differ from the acknowledged workflow. */
  const dirty = useRef(false);
  /** How many edits the intended values carry, so a save that lands mid-edit keeps it dirty. */
  const edits = useRef(0);
  /** The last document this saver stored, used while the board snapshot still lags behind it. */
  const lastStored = useRef<string | null>(null);
  /** The document the in-flight composition resolved to, so a success records it. */
  const desiredText = useRef<string | null>(null);
  /** The tail of the save chain: the next save waits for the one before it. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback((values: LayoutValues) => {
    desiredPositions.current = values.positions;
    desiredSizes.current = values.sizes;
    desiredConnections.current = values.connections;
    dirty.current = false;
  }, []);

  useEffect(() => {
    // A pending layout edit belongs to its board, so another board's acknowledged
    // workflow must not become the document it composes against.
    if (dirty.current && boardRef.current !== input.boardId) return;
    boardRef.current = input.boardId;
    acknowledgedRef.current = { workflow: input.workflow, workflowYaml: input.workflowYaml };
    // The intended values are composed against the newest acknowledged workflow at save
    // time, so an arrival while an edit is pending needs no rebase: it only replaces the
    // acknowledged snapshot, which a clean session adopts as its own.
    if (!dirty.current) adopt(readLayout(input.workflow));
  }, [input.workflowYaml, input.workflow, input.boardId, adopt]);

  const cancelTimer = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  /** Mark the intended values as changed by an edit that belongs to the current board and writer. */
  const markDirty = useCallback(() => {
    if (!dirty.current) {
      const current = inputRef.current;
      owner.current = { boardId: current.boardId, saveLayout: current.saveLayout, workflowYaml: current.workflowYaml };
    }
    dirty.current = true;
    edits.current += 1;
  }, []);

  const values = useCallback((): LayoutValues => ({
    positions: desiredPositions.current,
    sizes: desiredSizes.current,
    connections: desiredConnections.current,
  }), []);

  /**
   * Store the newest intended values, one save at a time and in the order asked for.
   * The chain always continues: a rejected save resets the intended layout and the next
   * one still runs.
   */
  const runSave = useCallback((): Promise<void> => {
    const next = chain.current.then(async () => {
      if (!dirty.current) return;
      const intended = values();
      const target = owner.current;
      const version = edits.current;
      try {
        await target.saveLayout(() => {
          // Compose onto the document this board presents. While the board snapshot still
          // lags behind a save already in flight, the document that save stored is the
          // newer one, so an undo lands on top of it instead of duplicating it.
          const snapshot = target.boardId === inputRef.current.boardId ? inputRef.current.workflowYaml : target.workflowYaml;
          const stored = lastStored.current;
          const base = stored !== null && stored !== snapshot ? stored : snapshot;
          const text = writeLayout(base, intended);
          desiredText.current = text === base ? null : text;
          return desiredText.current;
        });
        if (desiredText.current !== null) lastStored.current = desiredText.current;
        // An edit that arrived while this save was in flight is still unsaved.
        dirty.current = edits.current !== version;
      } catch (error) {
        // The layout is not persisted: return to the acknowledged workflow.
        adopt(readLayout(acknowledgedRef.current.workflow));
        rejectedRef.current?.();
        errorRef.current(error);
        // The caller decides what a failed save means: a history replay must not go on to
        // restore transitions onto a layout that was not stored.
        throw error;
      }
    });
    chain.current = next.then(() => undefined, () => undefined);
    return next;
  }, [adopt, values]);

  const queueSave = useCallback(() => {
    cancelTimer();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void runSave().catch(() => undefined);
    }, PLACEMENT_SAVE_DELAY_MS);
  }, [cancelTimer, runSave]);

  // A completed edit is already a user decision: send it before the view goes away.
  useEffect(() => () => { cancelTimer(); void runSave().catch(() => undefined); }, [cancelTimer, runSave]);

  const intendPositions = useCallback((next: StagePositions) => { desiredPositions.current = positionRecord(next); markDirty(); }, [markDirty]);
  const intendSizes = useCallback((next: StageSizes) => { desiredSizes.current = sizeRecord(next); markDirty(); }, [markDirty]);
  const intendConnections = useCallback((next: ConnectionLayouts) => { desiredConnections.current = connectionRecord(next); markDirty(); }, [markDirty]);
  const acceptConnections = useCallback((next: ConnectionLayouts) => { desiredConnections.current = connectionRecord(next); dirty.current = false; }, []);

  const saveNow = useCallback(() => { void runSave().catch(() => undefined); }, [runSave]);
  const flush = useCallback(async (): Promise<void> => { cancelTimer(); await runSave(); }, [cancelTimer, runSave]);
  const writeInto = useCallback((text: string) => writeLayout(text, values()), [values]);

  return {
    desiredPositions, desiredSizes, desiredConnections,
    intendPositions, intendSizes, intendConnections, acceptConnections,
    queueSave, saveNow, flush, writeInto, cancelTimer,
  };
}
