import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attention, BoardState, Column, ConnectionLayout, StagePosition, StageSize, Task } from '../../shared/types.js';
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
import { WorkflowCanvas, type CanvasConnection, type CanvasStage, type CanvasViewRequest, type ConnectionEdit, type WorkflowCanvasComponent } from './canvas.js';
import { connectionKey } from '../../domain/connection-anchor.js';
import { readConnections, type ConnectionLayouts } from '../../domain/workflow-connections.js';
import { mergeConnectionOverrides, useConnectionOverrides } from './use/use-connection-overrides.js';
import { buildWorkflowScene } from './scene.js';
import { computeAutoLayout, freezeAutoLayout, graphKey, type FrozenAutoLayout } from './auto-layout.js';
import { mergePlacements } from './placement-merge.js';
import { placementBounds, type StageLayout } from './layout.js';
import { canRedo, canUndo, redoStep, undoStep } from './history.js';
import { TravelLayer } from './travel-layer.js';
import { ViewControls } from './controls/view-controls.js';
import { useFlowLock } from './use/use-flow-lock.js';
import { useGridSnap } from './use/use-grid-snap.js';
import { useStageMeasurements } from './use/use-stage-measurements.js';
import { usePlacementHistory } from './use/use-placement-history.js';
import { usePlacementOverrides } from './use/use-placement-overrides.js';
import { usePlacementSaver } from './use/use-placement-saver.js';
import { useTravel } from './use/use-travel.js';
import { readWorkflowViewport, writeWorkflowViewport } from '../workflow-preference.js';

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
  /**
   * Opens the board's New task experience for the configured initial stage, taken
   * from the board's single creation instance. Absent when no registered project
   * can own a task, which leaves the action presented but unavailable. The diagram
   * never owns creation state, the dialog, or the first-execution handoff.
   */
  onCreateTask?: () => void;
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
 * state only: the frozen automatic placement and the fit request. The manual
 * overrides, stage measurement, the save queue, the layout history, the card
 * travel, the snapping preference, and the lock live in their own hooks, the
 * stage drag lives in the canvas; every move still runs through the board's move
 * pipeline, and every layout change is a workflow save.
 */
export function WorkflowView(props: WorkflowViewProps) {
  const stateRef = useRef(props.state); stateRef.current = props.state;
  const Canvas = props.canvas ?? WorkflowCanvas;
  const lock = useFlowLock();
  const grid = useGridSnap();
  const measurements = useStageMeasurements(props.state.workflow.columns);
  const measurementRef = measurements.measuredRef;

  const [overrides, setOverrides] = useState<Record<string, StagePosition>>({});
  const overridesRef = useRef(overrides); overridesRef.current = overrides;
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, StageSize>>({});
  const [viewRequest, setViewRequest] = useState<CanvasViewRequest>(() => {
    const stored = readWorkflowViewport(props.boardId);
    return stored === null ? { kind: 'fit' } : { kind: 'restore', viewport: stored };
  });
  const [viewToken, setViewToken] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const frozen = useRef<FrozenAutoLayout | null>(null);

  const workflowKey = useMemo(() => graphKey(props.state.workflow), [props.state.workflow]);
  const workflowKeyRef = useRef(workflowKey); workflowKeyRef.current = workflowKey;
  const stored = useMemo(() => readStagePositions(props.state.workflow), [props.state.workflow]);
  const storedSizes = useMemo(() => readStageSizes(props.state.workflow), [props.state.workflow]);
  const placement = usePlacementOverrides({ stored, storedSizes });
  const storedConnections = useMemo(() => readConnections(props.state.workflow), [props.state.workflow]);
  const connectionsPort = useConnectionOverrides(storedConnections);
  const intendConnection = connectionsPort.intend;
  const previewConnections = connectionsPort.preview;
  const resetConnections = connectionsPort.reset;
  const connectionOverrides = connectionsPort.overrides;
  const presentedConnections = useMemo(() => mergeConnectionOverrides(storedConnections, connectionOverrides), [storedConnections, connectionOverrides]);

  const history = usePlacementHistory();
  const resetHistory = history.reset;
  const resetPlacement = placement.reset;
  const resetAfterRejected = useCallback(() => {
    resetPlacement();
    frozen.current = null;
    setLayoutVersion(value => value + 1);
    resetConnections();
    resetHistory();
  }, [resetConnections, resetHistory, resetPlacement]);
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

  // The first reveal of a board shows the position that board stored. Every later
  // reveal follows a structural workflow change, which must frame the whole diagram
  // because a stage may have been added or removed.
  const firstReveal = useRef(true);
  useEffect(() => {
    if (!measurements.revealed) return;
    if (firstReveal.current) { firstReveal.current = false; return; }
    setViewRequest({ kind: 'fit' });
    setViewToken(value => value + 1);
  }, [measurements.revealed]);

  // Opening another board restores that board's own position instead of fitting it.
  const shownBoard = useRef(props.boardId);
  useEffect(() => {
    if (shownBoard.current === props.boardId) return;
    shownBoard.current = props.boardId;
    firstReveal.current = true;
    const stored = readWorkflowViewport(props.boardId);
    setViewRequest(stored === null ? { kind: 'fit' } : { kind: 'restore', viewport: stored });
    setViewToken(value => value + 1);
  }, [props.boardId]);

  const requestFit = useCallback(() => { setViewRequest({ kind: 'fit' }); setViewToken(value => value + 1); }, []);
  const storeViewport = useCallback((viewport: { x: number; y: number; zoom: number }) => { writeWorkflowViewport(props.boardId, viewport); }, [props.boardId]);

  const autoLayout = useMemo(() => {
    const compute = () => computeAutoLayout(props.state.workflow, measurements.measured);
    if (!measurements.revealed) return compute();
    const frozenLayout = freezeAutoLayout(frozen.current, workflowKey, compute);
    frozen.current = frozenLayout;
    return frozenLayout.layout;
  }, [props.state.workflow, workflowKey, measurements.measured, measurements.revealed, layoutVersion]);

  const placements = useMemo(() => mergePlacements(Object.fromEntries(autoLayout.placements), stored, placement.positions), [autoLayout, stored, placement.positions]);
  const placementsRef = useRef(placements); placementsRef.current = placements;

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
  const scene = useMemo(() => buildWorkflowScene({
    workflow: props.state.workflow, tasks: diagramTasks, placements, sizes: measurements.measured,
    connections: presentedConnections,
  }), [props.state.workflow, diagramTasks, placements, measurements.measured, presentedConnections]);

  const reposition = useCallback((positions: StagePositions, options: { readonly layout?: StagePositions; readonly clearOverrides: boolean; readonly immediate: boolean }) => {
    if (options.clearOverrides) placement.clearPositions();
    if (options.layout !== undefined) {
      frozen.current = { key: workflowKeyRef.current, layout: layoutFrom(options.layout) };
      setLayoutVersion(value => value + 1);
    }
    saver.intendPositions(positions);
    saver.cancelTimer();
    if (options.immediate) saver.saveNow(); else saver.queueSave();
  }, [layoutFrom, placement, saver]);

  const moveStage = useCallback((stageId: string, position: { x: number; y: number }) => {
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    const before: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const after: Record<string, StagePosition> = { ...before, [stageId]: rounded };
    const beforeLayout = visualPositions();
    const afterLayout: Record<string, StagePosition> = { ...beforeLayout, [stageId]: rounded };
    const sizes: StageSizes = { ...saver.desiredSizes.current };
    placement.beginPosition(stageId);
    placement.setPosition(stageId, rounded);
    history.push({ before, after, beforeSizes: sizes, afterSizes: sizes, beforeLayout, afterLayout });
    reposition(after, { clearOverrides: false, immediate: false });
  }, [history, placement, reposition, saver, visualPositions]);

  const resizeStage = useCallback((stageId: string, size: StageSize) => {
    placement.setSize(stageId, size);
  }, [placement]);

  const cancelResize = useCallback((stageId: string) => {
    placement.cancelSize(stageId);
  }, [placement]);

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
    placement.beginSize(stageId);
    placement.setSize(stageId, committed);
    const beforeSizes: Record<string, StageSize> = { ...saver.desiredSizes.current };
    const afterSizes: Record<string, StageSize> = { ...beforeSizes, [stageId]: committed };
    const positions: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const layout = visualPositions();
    history.push({ before: positions, after: positions, beforeSizes, afterSizes, beforeLayout: layout, afterLayout: layout });
    saver.intendSizes(afterSizes);
    saver.cancelTimer();
    saver.queueSave();
  }, [cancelResize, history, placement, saver, visualPositions]);

  /**
   * One completed arrow adjustment: the connection layout changes, the layout
   * history gains one step, and the coalesced save is queued. Only the edited
   * connection's entry changes.
   */
  const editConnection = useCallback((edit: ConnectionEdit) => {
    if (lock.locked) return;
    const connection = connectionsRef.current.find(value => value.id === edit.connectionId);
    if (connection === undefined) return;
    const key = connectionKey(connection.from, connection.to);
    const beforeConnections: ConnectionLayouts = { ...saver.desiredConnections.current };
    const source = edit.source ?? connection.source;
    const target = edit.target ?? connection.target;
    const segments = edit.segments ?? connection.segments;
    const after: ConnectionLayout = {
      from: connection.from,
      to: connection.to,
      ...(source === undefined ? {} : { source }),
      ...(target === undefined ? {} : { target }),
      ...(segments === undefined || segments.length === 0 ? {} : { segments: [...segments] }),
    };
    intendConnection(key, after);
    const afterConnections: ConnectionLayouts = { ...beforeConnections, [key]: after };
    const positions: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const sizes: Record<string, StageSize> = { ...saver.desiredSizes.current };
    const layout = visualPositions();
    history.push({ before: positions, after: positions, beforeSizes: sizes, afterSizes: sizes, beforeConnections, afterConnections, beforeLayout: layout, afterLayout: layout });
    saver.intendConnections(afterConnections);
    saver.cancelTimer();
    saver.queueSave();
  }, [history, intendConnection, lock.locked, saver, visualPositions]);

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
    requestFit();
  }, [history, lock.locked, measurementRef, reposition, requestFit, saver, visualPositions]);

  const undo = useCallback(() => {
    if (lock.locked) return;
    const step = undoStep(history.historyRef.current);
    if (step === null) return;
    const entry = history.historyRef.current.entries[history.historyRef.current.cursor - 1];
    history.replace(step.history);
    if (step.sizes !== undefined) { placement.previewSizes(step.sizes, saver.desiredSizes.current); saver.intendSizes(step.sizes); }
    if (step.connections !== undefined) { previewConnections(step.connections); saver.intendConnections(step.connections); }
    reposition(step.positions, { ...(entry?.beforeLayout === undefined ? {} : { layout: entry.beforeLayout }), clearOverrides: true, immediate: true });
  }, [history, lock.locked, placement, previewConnections, reposition, saver]);

  const redo = useCallback(() => {
    if (lock.locked) return;
    const step = redoStep(history.historyRef.current);
    if (step === null) return;
    const entry = history.historyRef.current.entries[history.historyRef.current.cursor];
    history.replace(step.history);
    if (step.sizes !== undefined) { placement.previewSizes(step.sizes, saver.desiredSizes.current); saver.intendSizes(step.sizes); }
    if (step.connections !== undefined) { previewConnections(step.connections); saver.intendConnections(step.connections); }
    reposition(step.positions, { ...(entry?.afterLayout === undefined ? {} : { layout: entry.afterLayout }), clearOverrides: true, immediate: true });
  }, [history, lock.locked, placement, previewConnections, reposition, saver]);

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
    connections: presentedConnections,
  });

  const stageSizeOf = useCallback((stageId: string): StageSize => effectiveStageSize(placement.sizes[stageId] ?? storedSizes[stageId]), [placement.sizes, storedSizes]);
  // The board creates in one stage: the workflow's configured initial stage. The
  // diagram presents the action there and nowhere else, and never lets the stage the
  // user is looking at decide where a task lands.
  const initialColumnId = props.state.workflow.initialColumnId;
  const stages: CanvasStage[] = scene.nodes.map(node => {
    const size = stageSizeOf(node.id);
    return { id: node.id, label: node.name, x: node.position.x, y: node.position.y, width: size.width, height: size.height, cardIds: node.tasks.map(task => task.id), creatable: node.id === initialColumnId };
  });
  const connections: CanvasConnection[] = scene.edges.map(edge => {
    const layout = presentedConnections[connectionKey(edge.from, edge.to)];
    return {
      id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, returning: edge.returning, fanOut: edge.fanOut, fanOutCount: edge.fanOutCount,
      ...(layout?.source === undefined ? {} : { source: layout.source }),
      ...(layout?.target === undefined ? {} : { target: layout.target }),
      ...(layout?.segments === undefined ? {} : { segments: layout.segments }),
    };
  });
  const connectionsRef = useRef(connections); connectionsRef.current = connections;

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
      viewRequest={viewRequest}
      viewToken={viewToken}
      onViewportChange={storeViewport}
      locked={lock.locked}
      snap={grid.snap}
      callbacks={{
        onMeasure: measurements.onMeasure,
        // Passed straight through: the diagram never decides where a task is created
        // and holds no creation state of its own. Absent when no registered project
        // can own a task, which leaves the action presented but unavailable; creating
        // is not a layout edit, so the lock never gates it.
        ...(props.onCreateTask === undefined ? {} : { onCreateTask: props.onCreateTask }),
      }}
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
        snapping={grid.enabled}
        onToggleSnap={grid.toggle}
        onToggleLock={lock.toggle}
      />}
      onStageMove={moveStage}
      onStageResize={resizeStage}
      onStageResizeEnd={commitResize}
      onStageResizeCancel={cancelResize}
      onConnectionEdit={editConnection}
    />
  </div>;
}
