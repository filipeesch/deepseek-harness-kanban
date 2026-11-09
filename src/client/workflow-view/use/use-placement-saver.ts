import { useCallback, useEffect, useRef } from 'react';
import type { StagePosition, StageSize, Workflow } from '../../../shared/types.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../../../domain/workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from '../../../domain/workflow-sizes.js';
import { sameStageSize } from '../../../domain/stage-size.js';
import type { RunCommand } from '../../ui.js';

/** How long a layout edit waits before it stores the workflow; one edit, one save. */
export const PLACEMENT_SAVE_DELAY_MS = 400;

export interface PlacementSaver {
  /** The placement this view intends to persist; edits compose against it. */
  readonly desiredPositions: React.MutableRefObject<Record<string, StagePosition>>;
  /** The sizes this view intends to persist. */
  readonly desiredSizes: React.MutableRefObject<Record<string, StageSize>>;
  intendPositions(positions: StagePositions): void;
  intendSizes(sizes: StageSizes): void;
  queueSave(): void;
  saveNow(): void;
  cancelTimer(): void;
}

function samePosition(left: StagePosition | undefined, right: StagePosition | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y;
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
  const adoptedPositions = useRef<Record<string, StagePosition>>(Object.create(null) as Record<string, StagePosition>);
  const adoptedSizes = useRef<Record<string, StageSize>>(Object.create(null) as Record<string, StageSize>);
  const boardRef = useRef(input.boardId);
  const sentYaml = useRef<string | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const freshPositions = readStagePositions(input.workflow);
    const freshSizes = readStageSizes(input.workflow);
    const unsaved = desiredYaml.current !== null && desiredYaml.current !== sentYaml.current;
    // A pending layout edit belongs to its board. The board presentation
    // remounts this view on a board switch, so the pending timer flushes that
    // edit; a different board's workflow must not be adopted into it.
    if (unsaved && boardRef.current !== input.boardId) return;
    boardRef.current = input.boardId;
    if (!unsaved) {
      desiredYaml.current = input.workflowYaml;
      sentYaml.current = input.workflowYaml;
      desiredPositions.current = freshPositions;
      desiredSizes.current = freshSizes;
      adoptedPositions.current = { ...freshPositions };
      adoptedSizes.current = { ...freshSizes };
      return;
    }
    // A new acknowledged workflow arrived while a layout edit is still unsaved.
    // Rebase only the stages this view changed onto the new text, so a concurrent
    // edit (a rename, new instructions, another stage's placement) survives the
    // pending save instead of being overwritten by the older text.
    const positions: Record<string, StagePosition> = { ...freshPositions };
    for (const id of new Set([...Object.keys(adoptedPositions.current), ...Object.keys(desiredPositions.current)])) {
      if (samePosition(desiredPositions.current[id], adoptedPositions.current[id])) continue;
      const wanted = desiredPositions.current[id];
      if (wanted === undefined) delete positions[id];
      else positions[id] = wanted;
    }
    const sizes: Record<string, StageSize> = { ...freshSizes };
    for (const id of new Set([...Object.keys(adoptedSizes.current), ...Object.keys(desiredSizes.current)])) {
      if (sameStageSize(desiredSizes.current[id], adoptedSizes.current[id])) continue;
      const wanted = desiredSizes.current[id];
      if (wanted === undefined) delete sizes[id];
      else sizes[id] = wanted;
    }
    desiredPositions.current = positions;
    desiredSizes.current = sizes;
    desiredYaml.current = setStageSizes(setStagePositions(input.workflowYaml, positions), sizes);
    sentYaml.current = input.workflowYaml;
    adoptedPositions.current = freshPositions;
    adoptedSizes.current = freshSizes;
  }, [input.workflowYaml, input.workflow]);

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
      const hubRevision = result.state?.hubs.find(hub => hub.id === input.hubId)?.revision;
      if (typeof hubRevision === 'number') revisionRef.current = hubRevision;
    } catch (error) {
      // The layout is not persisted: return to the acknowledged workflow and
      // drop the pending text that belonged to it.
      const acknowledged = acknowledgedRef.current;
      desiredYaml.current = acknowledged.workflowYaml;
      sentYaml.current = acknowledged.workflowYaml;
      desiredPositions.current = readStagePositions(acknowledged.workflow);
      desiredSizes.current = readStageSizes(acknowledged.workflow);
      adoptedPositions.current = { ...desiredPositions.current };
      adoptedSizes.current = { ...desiredSizes.current };
      rejectedRef.current?.();
      errorRef.current(error);
    } finally {
      saving.current = false;
    }
    if (queued.current) { queued.current = false; void runSave(); return; }
    if (desiredYaml.current !== null && desiredYaml.current !== sentYaml.current) void runSave();
  }, [input.hubId, input.boardId, input.run]);

  const queueSave = useCallback(() => {
    cancelTimer();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void runSave();
    }, PLACEMENT_SAVE_DELAY_MS);
  }, [cancelTimer, runSave]);

  // A completed edit is already a user decision: send it before the view goes away.
  useEffect(() => () => { cancelTimer(); void runSave(); }, [cancelTimer, runSave]);

  const intendPositions = useCallback((positions: StagePositions) => {
    desiredPositions.current = positionRecord(positions);
    desiredYaml.current = setStageSizes(setStagePositions(desiredYaml.current ?? acknowledgedRef.current.workflowYaml, desiredPositions.current), desiredSizes.current);
  }, []);

  const intendSizes = useCallback((sizes: StageSizes) => {
    desiredSizes.current = sizeRecord(sizes);
    desiredYaml.current = setStageSizes(setStagePositions(desiredYaml.current ?? acknowledgedRef.current.workflowYaml, desiredPositions.current), desiredSizes.current);
  }, []);

  const saveNow = useCallback(() => { void runSave(); }, [runSave]);

  return { desiredPositions, desiredSizes, intendPositions, intendSizes, queueSave, saveNow, cancelTimer };
}
