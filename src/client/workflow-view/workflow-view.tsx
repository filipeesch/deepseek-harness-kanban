import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attention, BoardState, Column, StagePosition, StageSize, Task } from '../../shared/types.js';
import { EMPTY_ATTENTION } from '../../shared/types.js';
import { placementIndex } from '../../domain/placement.js';
import { effectiveStageSize } from '../../domain/stage-size.js';
import { readStagePositions, type StagePositions } from '../../domain/workflow-positions.js';
import { readStageSizes, type StageSizes } from '../../domain/workflow-sizes.js';
import type { AutoRunController, AutoRunInput } from '../auto-run.js';
import { BoardCard } from '../board-card.js';
import type { CardEnvironment } from './card-environment.js';
import type { RunCommand } from '../ui.js';
import type { CardDragState } from '../useCardDrag.js';
import type { OptimisticMove } from '../useMoveRequest.js';
import { WorkflowCanvas, type CanvasConnection, type CanvasStage, type WorkflowCanvasComponent } from './canvas.js';
import { buildWorkflowScene } from './scene.js';
import { computeAutoLayout, freezeAutoLayout, graphKey, mergePlacements, samePosition, type FrozenAutoLayout } from './placement.js';
import { placementBounds, type StageLayout } from './layout.js';
import { canRedo, canUndo, redoStep, undoStep, type PlacementStep } from './history.js';
import { TravelLayer } from './travel-layer.js';
import { ViewControls } from './controls/view-controls.js';
import { useFlowLock } from './use/use-flow-lock.js';
import { useStageMeasurements } from './use/use-stage-measurements.js';
import { usePlacementHistory } from './use/use-placement-history.js';
import { usePlacementSaver } from './use/use-placement-saver.js';
import { useTravel } from './use/use-travel.js';

export { PLACEMENT_SAVE_DELAY_MS } from './use/use-placement-saver.js';

/**
 * The board's card, rendered inside a stage. The diagram never builds a card of
 * its own, so the two presentations cannot drift apart.
 */
export interface WorkflowCardPort {
  readonly attention: Readonly<Record<string, Attention>>;
  readonly projectNames: ReadonlyMap<string, string>;
  readonly autoRun: AutoRunController;
  readonly autoModePending: ReadonlySet<string>;
  readonly selectionMode: boolean;
  readonly selectedIds: ReadonlySet<string>;
  /** The tasks whose next-stage move is in flight, owned by the board. */
  readonly advancePending: ReadonlySet<string>;
  readonly onToggleAutoMode: (taskId: string, enabled: boolean) => void;
  readonly onToggleSelect: (taskId: string) => void;
  readonly onAdvance: (task: Task, column: Column) => Promise<unknown> | void;
  readonly onRun: (input: AutoRunInput) => void;
}

export interface WorkflowViewProps {
  hubId: string;
  boardId: string;
  state: BoardState;
  /** The cards the board shows for the active search and project filter. */
  tasks: readonly Task[];
  optimistic: OptimisticMove | null;
  drag: CardDragState | null;
  beginDrag: (event: React.PointerEvent<HTMLElement>, taskId: string, columnId: string) => void;
  shouldSuppressClick: () => boolean;
  run: RunCommand;
  /** Hub revision used as the workflow save precondition. */
  revision: number;
  onOpenTask: (taskId: string) => void;
  onError: (error: unknown) => void;
  /** Everything the board's card needs; the diagram only renders it. */
  card: WorkflowCardPort;
  /** Isolated harnesses substitute the canvas; production uses React Flow. */
  canvas?: WorkflowCanvasComponent;
}

function applyOptimistic(tasks: readonly Task[], move: OptimisticMove | null): readonly Task[] {
  if (move === null) return tasks;
  const moving = tasks.find(task => task.id === move.taskId);
  if (moving === undefined) return tasks;
  const rest = tasks.filter(task => task.id !== move.taskId);
  const destination = rest.filter(task => task.columnId === move.columnId);
  const at = placementIndex(move.placement, destination);
  const moved: Task = { ...moving, columnId: move.columnId };
  const result: Task[] = [];
  let inserted = false;
  let seen = 0;
  for (const task of rest) {
    if (task.columnId === move.columnId) {
      if (!inserted && seen === at) { result.push(moved); inserted = true; }
      seen += 1;
      result.push(task);
      continue;
    }
    result.push(task);
  }
  if (!inserted) result.push(moved);
  return result;
}

/**
 * The workflow diagram presentation of the active board. It owns presentation
 * state only: manual overrides, the frozen automatic placement, and the fit
 * request. Stage measurement, the save queue, the layout history, the card
 * travel, and the lock live in their own hooks; every move still runs through
 * the board's move pipeline, and every layout change is a workflow save.
 */
export function WorkflowView(props: WorkflowViewProps) {
  const stateRef = useRef(props.state); stateRef.current = props.state;
  const Canvas = props.canvas ?? WorkflowCanvas;
  const lock = useFlowLock();
  const measurements = useStageMeasurements(props.state.workflow.columns);
  const measurementRef = measurements.measuredRef;

  const [overrides, setOverrides] = useState<Record<string, StagePosition>>({});
  const overridesRef = useRef(overrides); overridesRef.current = overrides;
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, StageSize>>({});
  const [fitRequest, setFitRequest] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const frozen = useRef<FrozenAutoLayout | null>(null);
  const baselines = useRef<Record<string, StagePosition | undefined>>({});
  const sizeBaselines = useRef<Record<string, StageSize | undefined>>({});

  const workflowKey = useMemo(() => graphKey(props.state.workflow), [props.state.workflow]);
  const workflowKeyRef = useRef(workflowKey); workflowKeyRef.current = workflowKey;
  const stored = useMemo(() => readStagePositions(props.state.workflow), [props.state.workflow]);
  const storedRef = useRef(stored); storedRef.current = stored;
  const storedSizes = useMemo(() => readStageSizes(props.state.workflow), [props.state.workflow]);
  const storedSizesRef = useRef(storedSizes); storedSizesRef.current = storedSizes;

  const history = usePlacementHistory();
  const resetHistory = history.reset;
  const resetAfterRejected = useCallback(() => {
    setOverrides({});
    setSizeOverrides({});
    sizeBaselines.current = {};
    frozen.current = null;
    setLayoutVersion(value => value + 1);
    resetHistory();
  }, [resetHistory]);
  const saver = usePlacementSaver({
    hubId: props.hubId,
    boardId: props.boardId,
    run: props.run,
    revision: props.revision,
    workflow: props.state.workflow,
    workflowYaml: props.state.workflowYaml,
    onError: props.onError,
    onRejected: resetAfterRejected,
  });

  const lastWorkflowKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastWorkflowKey.current === workflowKey) return;
    const first = lastWorkflowKey.current === null;
    lastWorkflowKey.current = workflowKey;
    frozen.current = null;
    // A structural change normally resizes at least one stage, but a new stage at a
    // default size must still be measured before the diagram is shown again.
    if (!first) measurements.hide();
  }, [workflowKey, measurements.hide]);

  useEffect(() => {
    if (!measurements.revealed) return;
    setFitRequest(value => value + 1);
  }, [measurements.revealed]);

  const autoLayout = useMemo(() => {
    const compute = () => computeAutoLayout(props.state.workflow, measurements.measured);
    if (!measurements.revealed) return compute();
    const frozenLayout = freezeAutoLayout(frozen.current, workflowKey, compute);
    frozen.current = frozenLayout;
    return frozenLayout.layout;
  }, [props.state.workflow, workflowKey, measurements.measured, measurements.revealed, layoutVersion]);

  const placements = useMemo(() => mergePlacements(Object.fromEntries(autoLayout.placements), stored, overrides), [autoLayout, stored, overrides]);
  const placementsRef = useRef(placements); placementsRef.current = placements;

  // An override lives only until the store settles it: the save landing at the
  // same position, an external change, or an external removal.
  useEffect(() => {
    setOverrides(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, StagePosition> = {};
      for (const [id, position] of entries) {
        const saved = stored[id];
        const baseline = baselines.current[id];
        const landed = saved !== undefined && samePosition(saved, position);
        const replaced = saved === undefined
          ? baseline !== undefined
          : !samePosition(saved, position) && !samePosition(saved, baseline);
        if (landed || replaced) { changed = true; continue; }
        next[id] = position;
      }
      return changed ? next : current;
    });
  }, [stored]);

  // A size override is settled by the same save that stores it, or yields to an
  // external change, exactly like a placement override: an acknowledged size
  // that differs from the baseline the edit started from wins. A stage whose
  // authored size is gone renders at the minimum, so that also settles.
  useEffect(() => {
    setSizeOverrides(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, StageSize> = {};
      for (const [id, size] of entries) {
        const saved = effectiveStageSize(storedSizes[id]);
        const baseline = effectiveStageSize(sizeBaselines.current[id]);
        const landed = saved.width === size.width && saved.height === size.height;
        const replaced = saved.width !== baseline.width || saved.height !== baseline.height;
        if (landed || replaced) { changed = true; continue; }
        next[id] = size;
      }
      return changed ? next : current;
    });
  }, [storedSizes]);

  const visualPositions = useCallback((): Record<string, StagePosition> => {
    const result: Record<string, StagePosition> = {};
    for (const [id, position] of placementsRef.current) result[id] = { x: position.x, y: position.y };
    return result;
  }, []);

  const layoutFrom = useCallback((positions: StagePositions): StageLayout => {
    const map = new Map<string, StagePosition>();
    for (const [id, position] of Object.entries(positions)) if (position !== undefined) map.set(id, position);
    return { placements: map, bounds: placementBounds(map, measurementRef.current) };
  }, [measurementRef]);
  const diagramTasks = useMemo(() => applyOptimistic(props.tasks, props.optimistic), [props.tasks, props.optimistic]);
  const scene = useMemo(() => buildWorkflowScene({ workflow: props.state.workflow, tasks: diagramTasks, placements, sizes: measurements.measured }), [props.state.workflow, diagramTasks, placements, measurements.measured]);

  const reposition = useCallback((positions: StagePositions, options: { readonly layout?: StagePositions; readonly clearOverrides: boolean; readonly immediate: boolean }) => {
    if (options.clearOverrides) setOverrides({});
    if (options.layout !== undefined) {
      frozen.current = { key: workflowKeyRef.current, layout: layoutFrom(options.layout) };
      setLayoutVersion(value => value + 1);
    }
    saver.intendPositions(positions);
    saver.cancelTimer();
    if (options.immediate) saver.saveNow(); else saver.queueSave();
  }, [layoutFrom, saver]);

  const moveStage = useCallback((stageId: string, position: { x: number; y: number }) => {
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    const before: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const after: Record<string, StagePosition> = { ...before, [stageId]: rounded };
    const beforeLayout = visualPositions();
    const afterLayout: Record<string, StagePosition> = { ...beforeLayout, [stageId]: rounded };
    const sizes: StageSizes = { ...saver.desiredSizes.current };
    const nextBaselines = Object.create(null) as Record<string, StagePosition | undefined>;
    Object.assign(nextBaselines, baselines.current, { [stageId]: storedRef.current[stageId] });
    baselines.current = nextBaselines;
    setOverrides(current => ({ ...current, [stageId]: rounded }));
    history.push({ before, after, beforeSizes: sizes, afterSizes: sizes, beforeLayout, afterLayout });
    reposition(after, { clearOverrides: false, immediate: false });
  }, [history, reposition, saver, visualPositions]);

  const resizeStage = useCallback((stageId: string, size: StageSize) => {
    setSizeOverrides(current => ({ ...current, [stageId]: size }));
  }, []);

  const cancelResize = useCallback((stageId: string) => {
    setSizeOverrides(current => {
      if (!Object.prototype.hasOwnProperty.call(current, stageId)) return current;
      const next = { ...current };
      delete next[stageId];
      return next;
    });
  }, []);

  const commitResize = useCallback((stageId: string, size: StageSize) => {
    const committed = { width: Math.round(size.width), height: Math.round(size.height) };
    const authored = saver.desiredSizes.current[stageId];
    const unchanged = authored === undefined
      ? committed.width === effectiveStageSize(undefined).width && committed.height === effectiveStageSize(undefined).height
      : authored.width === committed.width && authored.height === committed.height;
    // A press that never changed the size is not a layout edit.
    if (unchanged) { cancelResize(stageId); return; }
    // The override stays until the save lands, so a resized stage never snaps
    // back while its workflow save is still queued.
    sizeBaselines.current = { ...sizeBaselines.current, [stageId]: storedSizesRef.current[stageId] };
    setSizeOverrides(current => ({ ...current, [stageId]: committed }));
    const beforeSizes: Record<string, StageSize> = { ...saver.desiredSizes.current };
    const afterSizes: Record<string, StageSize> = { ...beforeSizes, [stageId]: committed };
    const positions: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const layout = visualPositions();
    history.push({ before: positions, after: positions, beforeSizes, afterSizes, beforeLayout: layout, afterLayout: layout });
    saver.intendSizes(afterSizes);
    saver.cancelTimer();
    saver.queueSave();
  }, [cancelResize, history, saver, visualPositions]);

  const organize = useCallback(() => {
    if (lock.locked) return;
    const layout = computeAutoLayout(stateRef.current.workflow, measurementRef.current);
    const next: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
    for (const [id, position] of layout.placements) next[id] = { x: Math.round(position.x), y: Math.round(position.y) };
    const before = { ...saver.desiredPositions.current };
    const sizes: StageSizes = { ...saver.desiredSizes.current };
    const beforeLayout = visualPositions();
    frozen.current = { key: graphKey(stateRef.current.workflow), layout };
    setLayoutVersion(value => value + 1);
    history.push({ before, after: next, beforeSizes: sizes, afterSizes: sizes, beforeLayout, afterLayout: next });
    reposition(next, { clearOverrides: true, immediate: true });
    setFitRequest(value => value + 1);
  }, [history, lock.locked, measurementRef, reposition, saver, visualPositions]);

  /** Show the intended sizes right away, the way a layout snapshot restores positions. */
  const previewSizes = useCallback((target: StageSizes) => {
    const ids = new Set([...Object.keys(saver.desiredSizes.current), ...Object.keys(target)]);
    const next: Record<string, StageSize> = {};
    const nextBaselines: Record<string, StageSize | undefined> = { ...sizeBaselines.current };
    for (const id of ids) {
      const intended = effectiveStageSize(target[id]);
      const current = effectiveStageSize(storedSizesRef.current[id]);
      // An override that changes nothing would outlive the edit and mask a later
      // acknowledged size, so it is only set when the rendition must change now.
      if (intended.width === current.width && intended.height === current.height) continue;
      next[id] = intended;
      nextBaselines[id] = storedSizesRef.current[id];
    }
    sizeBaselines.current = nextBaselines;
    setSizeOverrides(next);
  }, [saver]);

  const undo = useCallback(() => {
    if (lock.locked) return;
    const step = undoStep(history.historyRef.current);
    if (step === null) return;
    const entry = history.historyRef.current.entries[history.historyRef.current.cursor - 1];
    history.replace(step.history);
    if (step.sizes !== undefined) { previewSizes(step.sizes); saver.intendSizes(step.sizes); }
    reposition(step.positions, { ...(entry?.beforeLayout === undefined ? {} : { layout: entry.beforeLayout }), clearOverrides: true, immediate: true });
  }, [history, lock.locked, previewSizes, reposition, saver]);

  const redo = useCallback(() => {
    if (lock.locked) return;
    const step = redoStep(history.historyRef.current);
    if (step === null) return;
    const entry = history.historyRef.current.entries[history.historyRef.current.cursor];
    history.replace(step.history);
    if (step.sizes !== undefined) { previewSizes(step.sizes); saver.intendSizes(step.sizes); }
    reposition(step.positions, { ...(entry?.afterLayout === undefined ? {} : { layout: entry.afterLayout }), clearOverrides: true, immediate: true });
  }, [history, lock.locked, previewSizes, reposition, saver]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, [role="dialog"]') !== null) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const travel = useTravel({
    workflow: props.state.workflow,
    stateTasks: props.state.tasks,
    tasks: props.tasks,
    placements,
    measured: measurements.measured,
  });

  const stageSizeOf = useCallback((stageId: string): StageSize => effectiveStageSize(sizeOverrides[stageId] ?? storedSizes[stageId]), [sizeOverrides, storedSizes]);
  const stages: CanvasStage[] = scene.nodes.map(node => {
    const size = stageSizeOf(node.id);
    return { id: node.id, label: node.name, x: node.position.x, y: node.position.y, width: size.width, height: size.height, cardIds: node.tasks.map(task => task.id) };
  });
  const connections: CanvasConnection[] = scene.edges.map(edge => ({
    id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, returning: edge.returning, fanOut: edge.fanOut, fanOutCount: edge.fanOutCount,
  }));

  const tasksById = useMemo(() => new Map(props.state.tasks.map(task => [task.id, task])), [props.state.tasks]);
  const columnsById = useMemo(() => new Map(props.state.workflow.columns.map(column => [column.id, column])), [props.state.workflow.columns]);
  const cardEnvironment = useMemo<CardEnvironment>(() => ({
    renderCard(taskId: string) {
      const task = tasksById.get(taskId);
      if (task === undefined) return null;
      const column = columnsById.get(task.columnId);
      if (column === undefined) return null;
      return <BoardCard
        task={task}
        column={column}
        projectName={props.card.projectNames.get(task.projectId) ?? task.projectId}
        attention={props.card.attention[task.id] ?? EMPTY_ATTENTION}
        workflow={props.state.workflow}
        selectionMode={props.card.selectionMode}
        selected={props.card.selectedIds.has(task.id)}
        autoRun={props.card.autoRun}
        autoModePending={props.card.autoModePending.has(task.id)}
        onToggleAutoMode={props.card.onToggleAutoMode}
        onOpen={props.onOpenTask}
        onToggleSelect={props.card.onToggleSelect}
        onBeginDrag={props.beginDrag}
        shouldSuppressClick={props.shouldSuppressClick}
        onMoveTask={(_task, target) => props.card.onAdvance(task, target)}
        advancePending={props.card.advancePending.has(task.id)}
        onRun={props.card.onRun}
      />;
    },
  }), [tasksById, columnsById, props.card, props.state.workflow, props.onOpenTask, props.beginDrag, props.shouldSuppressClick]);

  return <div className="kb-flow-shell" role="region" aria-label="Workflow diagram">
    <Canvas
      stages={stages}
      connections={connections}
      ready={measurements.revealed}
      fitRequest={fitRequest}
      locked={lock.locked}
      callbacks={{ onMeasure: measurements.onMeasure }}
      cardEnvironment={cardEnvironment}
      dropStageId={props.drag?.overColumnId ?? null}
      dropIndicatorY={props.drag?.overColumnId === undefined ? null : props.drag.indicatorY}
      {...(travel.travel.length === 0 ? {} : { overlay: <TravelLayer moves={travel.travel} onFinished={travel.finish} /> })}
      controls={viewport => <ViewControls
        locked={lock.locked}
        canUndo={canUndo(history.history)}
        canRedo={canRedo(history.history)}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        onFit={viewport.fit}
        onUndo={undo}
        onRedo={redo}
        onOrganize={organize}
        onToggleLock={lock.toggle}
      />}
      onStageMove={moveStage}
      onStageResize={resizeStage}
      onStageResizeEnd={commitResize}
      onStageResizeCancel={cancelResize}
    />
  </div>;
}
