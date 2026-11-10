import { useCallback, useEffect, useRef } from 'react';
import type { ConnectionLayout, StagePosition, StageSize, Workflow } from '../../../shared/types.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../../../domain/workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from '../../../domain/workflow-sizes.js';
import { readConnections, setConnections, type ConnectionLayouts } from '../../../domain/workflow-connections.js';
import { sameStageSize } from '../../../domain/stage-size.js';
import { samePosition } from '../../../domain/stage-position.js';
import { sameConnectionLayout } from '../../../domain/connection-anchor.js';
import type { RunCommand } from '../../ui.js';
import { hubRevisionOf } from '../../workflow-save.js';

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
  queueSave(): void;
  saveNow(): void;
  cancelTimer(): void;
}

/** One authored layout field: how two values are compared and how the intended record is normalized. */
interface LayoutField<V> {
  readonly same: (left: V | undefined, right: V | undefined) => boolean;
  readonly record: (values: Record<string, V | undefined>) => Record<string, V>;
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

const positions: LayoutField<StagePosition> = { same: samePosition, record: positionRecord };
const sizes: LayoutField<StageSize> = { same: sameStageSize, record: sizeRecord };
const connections: LayoutField<ConnectionLayout> = { same: sameConnectionLayout, record: connectionRecord };

/** One layout as the view intends it: every field at once. */
interface LayoutValues {
  readonly positions: Record<string, StagePosition>;
  readonly sizes: Record<string, StageSize>;
  readonly connections: Record<string, ConnectionLayout>;
}

function readLayout(workflow: Workflow): LayoutValues {
  return { positions: readStagePositions(workflow), sizes: readStageSizes(workflow), connections: readConnections(workflow) };
}

function writeLayout(text: string, values: LayoutValues): string {
  return setConnections(setStageSizes(setStagePositions(text, values.positions), values.sizes), values.connections);
}

/**
 * Rebase one field: start from the newly acknowledged values and carry over only
 * the entries this view changed, so a concurrent edit survives a pending save.
 */
function rebaseField<V>(field: LayoutField<V>, fresh: Readonly<Record<string, V>>, adopted: Readonly<Record<string, V>>, desired: Readonly<Record<string, V>>): Record<string, V> {
  const next: Record<string, V> = { ...fresh };
  for (const id of new Set([...Object.keys(adopted), ...Object.keys(desired)])) {
    if (field.same(desired[id], adopted[id])) continue;
    const wanted = desired[id];
    if (wanted === undefined) delete next[id];
    else next[id] = wanted;
  }
  return next;
}

export interface PlacementSaverInput {
  readonly hubId: string;
  readonly boardId: string;
  readonly run: RunCommand;
  /** The latest Hub revision used as the save precondition. */
  readonly revision: number;
  readonly workflow: Workflow;
  readonly workflowYaml: string;
  readonly onError: (error: unknown) => void;
  /** Called after a rejected save reset the intended layout to the acknowledged one. */
  readonly onRejected?: () => void;
}

/**
 * The coalesced workflow save for layout edits.
 *
 * Edits compose against the text this view intends to persist, never against
 * the last acknowledged snapshot: an Undo that follows an already dispatched
 * save must queue a compensating save instead of becoming a no-op. A save in
 * flight coalesces the next one, a rejected save returns everything to the
 * acknowledged workflow, and a completed edit is flushed before unmount.
 */
export function usePlacementSaver(input: PlacementSaverInput): PlacementSaver {
  const revisionRef = useRef(input.revision); revisionRef.current = input.revision;
  const acknowledgedRef = useRef({ workflow: input.workflow, workflowYaml: input.workflowYaml });
  acknowledgedRef.current = { workflow: input.workflow, workflowYaml: input.workflowYaml };
  const errorRef = useRef(input.onError); errorRef.current = input.onError;
  const rejectedRef = useRef(input.onRejected); rejectedRef.current = input.onRejected;

  const desiredYaml = useRef<string | null>(null);
  const desiredPositions = useRef<Record<string, StagePosition>>(Object.create(null) as Record<string, StagePosition>);
  const desiredSizes = useRef<Record<string, StageSize>>(Object.create(null) as Record<string, StageSize>);
  const desiredConnections = useRef<Record<string, ConnectionLayout>>(Object.create(null) as Record<string, ConnectionLayout>);
  const adoptedPositions = useRef<Record<string, StagePosition>>(Object.create(null) as Record<string, StagePosition>);
  const adoptedSizes = useRef<Record<string, StageSize>>(Object.create(null) as Record<string, StageSize>);
  const adoptedConnections = useRef<Record<string, ConnectionLayout>>(Object.create(null) as Record<string, ConnectionLayout>);
  const boardRef = useRef(input.boardId);
  const sentYaml = useRef<string | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback((values: LayoutValues) => {
    desiredPositions.current = values.positions;
    desiredSizes.current = values.sizes;
    desiredConnections.current = values.connections;
    adoptedPositions.current = { ...values.positions };
    adoptedSizes.current = { ...values.sizes };
    adoptedConnections.current = { ...values.connections };
  }, []);

  useEffect(() => {
    const fresh = readLayout(input.workflow);
    const unsaved = desiredYaml.current !== null && desiredYaml.current !== sentYaml.current;
    // A pending layout edit belongs to its board. The board presentation
    // remounts this view on a board switch, so the pending timer flushes that
    // edit; a different board's workflow must not be adopted into it.
    if (unsaved && boardRef.current !== input.boardId) return;
    boardRef.current = input.boardId;
    if (!unsaved) {
      desiredYaml.current = input.workflowYaml;
      sentYaml.current = input.workflowYaml;
      adopt(fresh);
      return;
    }
    // A new acknowledged workflow arrived while a layout edit is still unsaved.
    // Rebase only the entries this view changed onto the new text, so a concurrent
    // edit (a rename, new instructions, another stage's placement) survives the
    // pending save instead of being overwritten by the older text.
    const rebased: LayoutValues = {
      positions: rebaseField(positions, fresh.positions, adoptedPositions.current, desiredPositions.current),
      sizes: rebaseField(sizes, fresh.sizes, adoptedSizes.current, desiredSizes.current),
      connections: rebaseField(connections, fresh.connections, adoptedConnections.current, desiredConnections.current),
    };
    desiredPositions.current = rebased.positions;
    desiredSizes.current = rebased.sizes;
    desiredConnections.current = rebased.connections;
    desiredYaml.current = writeLayout(input.workflowYaml, rebased);
    sentYaml.current = input.workflowYaml;
    adoptedPositions.current = fresh.positions;
    adoptedSizes.current = fresh.sizes;
    adoptedConnections.current = fresh.connections;
  }, [input.workflowYaml, input.workflow, adopt]);

  const cancelTimer = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  const runSave = useCallback(async (): Promise<void> => {
    if (saving.current) { queued.current = true; return; }
    const text = desiredYaml.current;
    if (text === null || text === sentYaml.current) return;
    saving.current = true;
    try {
      const result = await input.run({ type: 'board.workflow.save', hubId: input.hubId, boardId: input.boardId, yaml: text, expectedRevision: revisionRef.current });
      sentYaml.current = text;
      const hubRevision = hubRevisionOf(result, input.hubId);
      if (typeof hubRevision === 'number') revisionRef.current = hubRevision;
    } catch (error) {
      // The layout is not persisted: return to the acknowledged workflow and
      // drop the pending text that belonged to it.
      const acknowledged = acknowledgedRef.current;
      desiredYaml.current = acknowledged.workflowYaml;
      sentYaml.current = acknowledged.workflowYaml;
      adopt(readLayout(acknowledged.workflow));
      rejectedRef.current?.();
      errorRef.current(error);
    } finally {
      saving.current = false;
    }
    if (queued.current) { queued.current = false; void runSave(); return; }
    if (desiredYaml.current !== null && desiredYaml.current !== sentYaml.current) void runSave();
  }, [adopt, input.hubId, input.boardId, input.run]);

  const queueSave = useCallback(() => {
    cancelTimer();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void runSave();
    }, PLACEMENT_SAVE_DELAY_MS);
  }, [cancelTimer, runSave]);

  // A completed edit is already a user decision: send it before the view goes away.
  useEffect(() => () => { cancelTimer(); void runSave(); }, [cancelTimer, runSave]);

  const compose = useCallback(() => {
    desiredYaml.current = writeLayout(desiredYaml.current ?? acknowledgedRef.current.workflowYaml, {
      positions: desiredPositions.current,
      sizes: desiredSizes.current,
      connections: desiredConnections.current,
    });
  }, []);

  const intendPositions = useCallback((next: StagePositions) => {
    desiredPositions.current = positionRecord(next);
    compose();
  }, [compose]);

  const intendSizes = useCallback((next: StageSizes) => {
    desiredSizes.current = sizeRecord(next);
    compose();
  }, [compose]);

  const intendConnections = useCallback((next: ConnectionLayouts) => {
    desiredConnections.current = connectionRecord(next);
    compose();
  }, [compose]);

  const saveNow = useCallback(() => { void runSave(); }, [runSave]);

  return { desiredPositions, desiredSizes, desiredConnections, intendPositions, intendSizes, intendConnections, queueSave, saveNow, cancelTimer };
}
