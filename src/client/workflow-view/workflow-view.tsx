import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attention, BoardState, Column, ConnectionLayout, StagePosition, StageSize, Task } from '../../shared/types.js';
import { EMPTY_ATTENTION } from '../../shared/types.js';
import { placementIndex } from '../../domain/placement.js';
import { connectionKey } from '../../domain/connection-anchor.js';
import { effectiveStageSize } from '../../domain/stage-size.js';
import type { StagePositions } from '../../domain/workflow-positions.js';
import type { ConnectionLayouts } from '../../domain/workflow-connections.js';
import type { AutoRunController, AutoRunInput } from '../auto-run.js';
import { BoardCard } from '../board-card.js';
import type { CardEnvironment } from './card-environment.js';
import type { RunCommand } from '../ui.js';
import type { CardDragState } from '../useCardDrag.js';
import type { OptimisticMove } from '../useMoveRequest.js';
import { WorkflowCanvas, type CanvasConnection, type CanvasStage, type CanvasViewRequest, type ConditionAnchor, type ConnectionEdit, type WorkflowCanvasComponent } from './canvas.js';
import { ConditionPopover } from './condition-popover.js';
import { presentWorkflow, presentedRules } from './present-workflow.js';
import { computeAutoLayout, graphKey } from '../../domain/diagram/auto-layout.js';
import { useTransitionOverrides } from './use/use-transition-overrides.js';
import { useTransitionActions } from './use/use-transition-actions.js';
import { useWorkflowLayout } from './use/use-workflow-layout.js';
import { useWorkflowWrites } from '../workflow-write.js';
import { connectionLayoutOf } from './edge-model.js';
import { buildWorkflowScene } from '../../domain/diagram/scene.js';
import { canRedo, canUndo, redoStep, undoStep } from './history.js';
import { TransitLayer } from './transit/layer.js';
import { ViewControls } from './controls/view-controls.js';
import { useFlowLock } from './use/use-flow-lock.js';
import { useGridSnap } from './use/use-grid-snap.js';
import { useStageMeasurements } from './use/use-stage-measurements.js';
import { useArrivals } from './use/use-arrivals.js';
import { useTransit } from './use/use-transit.js';
import { supportsPathMotion } from './transit/port.js';
import { HOST_MOTION_PREFERENCE, useReducedMotion, type MotionPreferencePort } from './use/use-reduced-motion.js';
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
   * can own a task, which leaves the action presented but unavailable.
   */
  onCreateTask?: () => void;
  /**
   * Opens the board's stage editor for one stage. The board owns the dialog, so the
   * diagram never holds a stage draft of its own.
   */
  onEditStage?: (stageId: string) => void;
  /** Isolated harnesses substitute the canvas; production uses React Flow. */
  canvas?: WorkflowCanvasComponent;
  /** Isolated harnesses may replace the host's path-motion capability probe. */
  supportsTransit?: () => boolean;
  /** Isolated harnesses may replace the host's motion preference. */
  motionPreference?: MotionPreferencePort;
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
 * The workflow diagram presentation of the active board.
 *
 * It owns composition only. The authored layout, the write queue, the optimistic
 * transitions, the connection gestures, and the card transit live in their own
 * modules; every move still runs through the board's move pipeline, and every
 * workflow change is one queued write.
 */
export function WorkflowView(props: WorkflowViewProps) {
  const Canvas = props.canvas ?? WorkflowCanvas;
  const lock = useFlowLock();
  const grid = useGridSnap();
  const measurements = useStageMeasurements(props.state.workflow.columns);
  const [viewRequest, setViewRequest] = useState<CanvasViewRequest>(() => {
    const stored = readWorkflowViewport(props.boardId);
    return stored === null ? { kind: 'fit' } : { kind: 'restore', viewport: stored };
  });
  const [viewToken, setViewToken] = useState(0);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [conditionEditor, setConditionEditor] = useState<{ connectionId: string; anchor: ConditionAnchor } | null>(null);

  const writes = useWorkflowWrites({ hubId: props.hubId, boardId: props.boardId, run: props.run, revision: props.revision });
  const resetRef = useRef<() => void>(() => {});
  const layout = useWorkflowLayout({
    hubId: props.hubId,
    boardId: props.boardId,
    workflow: props.state.workflow,
    workflowYaml: props.state.workflowYaml,
    saveLayout: writes.saveLayout,
    measured: measurements.measured,
    revealed: measurements.revealed,
    onError: props.onError,
    onRejected: () => resetRef.current(),
  });
  resetRef.current = layout.reset;

  const transitions = useTransitionOverrides(props.state.workflow);
  const presented = useMemo(() => presentWorkflow(props.state.workflow, transitions.overrides), [props.state.workflow, transitions.overrides]);
  const presentedRef = useRef(presented); presentedRef.current = presented;

  const actions = useTransitionActions({
    workflow: () => presentedRef.current,
    writes,
    overrides: transitions,
    history: layout.history,
    connections: layout.connections,
    positions: layout.visualPositions,
    sizes: () => ({ ...layout.saver.desiredSizes.current }),
    onError: props.onError,
  });
  const actionsRef = useRef(actions); actionsRef.current = actions;

  // A structural change resets the frozen automatic placement and hides the diagram
  // until every stage is measured again.
  const workflowKey = graphKey(props.state.workflow);
  const lastWorkflowKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastWorkflowKey.current === workflowKey) return;
    const first = lastWorkflowKey.current === null;
    lastWorkflowKey.current = workflowKey;
    layout.invalidate();
    if (!first) measurements.hide();
  }, [workflowKey, measurements.hide, layout.invalidate]);

  // The first reveal of a board shows the position that board stored. Every later
  // reveal follows a structural workflow change, which must frame the whole diagram.
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

  const diagramTasks = useMemo(() => applyOptimistic(props.tasks, props.optimistic), [props.tasks, props.optimistic]);
  const scene = useMemo(() => buildWorkflowScene({
    workflow: presented, tasks: diagramTasks, placements: layout.placements, sizes: measurements.measured,
    connections: layout.connectionLayouts,
  }), [presented, diagramTasks, layout.placements, measurements.measured, layout.connectionLayouts]);

  const reposition = useCallback((positions: StagePositions, options: { readonly layout?: StagePositions; readonly clearOverrides: boolean; readonly immediate: boolean }) => {
    const saver = layout.saver;
    if (options.clearOverrides) layout.placement.clearPositions();
    if (options.layout !== undefined) layout.freeze(layout.layoutFrom(options.layout));
    saver.intendPositions(positions);
    saver.cancelTimer();
    if (options.immediate) saver.saveNow(); else saver.queueSave();
  }, [layout]);

  const moveStage = useCallback((stageId: string, position: { x: number; y: number }) => {
    const saver = layout.saver;
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    const before: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const after: Record<string, StagePosition> = { ...before, [stageId]: rounded };
    const beforeLayout = layout.visualPositions();
    const afterLayout: Record<string, StagePosition> = { ...beforeLayout, [stageId]: rounded };
    const sizes = { ...saver.desiredSizes.current };
    layout.placement.beginPosition(stageId);
    layout.placement.setPosition(stageId, rounded);
    layout.history.push({ before, after, beforeSizes: sizes, afterSizes: sizes, beforeLayout, afterLayout });
    reposition(after, { clearOverrides: false, immediate: false });
  }, [layout, reposition]);

  const resizeStage = useCallback((stageId: string, size: StageSize) => { layout.placement.setSize(stageId, size); }, [layout]);
  const cancelResize = useCallback((stageId: string) => { layout.placement.cancelSize(stageId); }, [layout]);

  const commitResize = useCallback((stageId: string, size: StageSize) => {
    const saver = layout.saver;
    const committed = { width: Math.round(size.width), height: Math.round(size.height) };
    const authored = saver.desiredSizes.current[stageId];
    const unchanged = authored === undefined
      ? committed.width === effectiveStageSize(undefined).width && committed.height === effectiveStageSize(undefined).height
      : authored.width === committed.width && authored.height === committed.height;
    if (unchanged) { layout.placement.cancelSize(stageId); return; }
    layout.placement.beginSize(stageId);
    layout.placement.setSize(stageId, committed);
    const beforeSizes: Record<string, StageSize> = { ...saver.desiredSizes.current };
    const afterSizes: Record<string, StageSize> = { ...beforeSizes, [stageId]: committed };
    const positions: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const snapshot = layout.visualPositions();
    layout.history.push({ before: positions, after: positions, beforeSizes, afterSizes, beforeLayout: snapshot, afterLayout: snapshot });
    saver.intendSizes(afterSizes);
    saver.cancelTimer();
    saver.queueSave();
  }, [layout]);

  const connectionsRef = useRef<readonly CanvasConnection[]>([]);

  /** One completed arrow adjustment: the connection layout changes and one step is recorded. */
  const editConnection = useCallback((edit: ConnectionEdit) => {
    if (lock.locked) return;
    const saver = layout.saver;
    const connection = connectionsRef.current.find(value => value.id === edit.connectionId);
    if (connection === undefined) return;
    const key = connectionKey(connection.from, connection.to);
    const beforeConnections: ConnectionLayouts = { ...saver.desiredConnections.current };
    const after = connectionLayoutOf(connection, {
      ...(edit.source === undefined ? {} : { source: edit.source }),
      ...(edit.target === undefined ? {} : { target: edit.target }),
      ...(edit.segments === undefined ? {} : { segments: edit.segments }),
    });
    layout.intendConnection(key, after);
    const afterConnections: ConnectionLayouts = { ...beforeConnections, [key]: after };
    const positions: Record<string, StagePosition> = { ...saver.desiredPositions.current };
    const sizes: Record<string, StageSize> = { ...saver.desiredSizes.current };
    const snapshot = layout.visualPositions();
    layout.history.push({ before: positions, after: positions, beforeSizes: sizes, afterSizes: sizes, beforeConnections, afterConnections, beforeLayout: snapshot, afterLayout: snapshot });
    saver.intendConnections(afterConnections);
    saver.cancelTimer();
    saver.queueSave();
  }, [layout, lock.locked]);

  const organize = useCallback(() => {
    if (lock.locked) return;
    const computed = computeAutoLayout(props.state.workflow, measurements.measuredRef.current);
    const next: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
    for (const [id, position] of computed.placements) next[id] = { x: Math.round(position.x), y: Math.round(position.y) };
    const before = { ...layout.saver.desiredPositions.current };
    const sizes = { ...layout.saver.desiredSizes.current };
    const beforeLayout = layout.visualPositions();
    layout.freeze(computed);
    layout.history.push({ before, after: next, beforeSizes: sizes, afterSizes: sizes, beforeLayout, afterLayout: next });
    reposition(next, { clearOverrides: true, immediate: true });
    requestFit();
  }, [layout, lock.locked, measurements.measuredRef, props.state.workflow, reposition, requestFit]);

  const undo = useCallback(() => {
    if (lock.locked) return;
    const history = layout.history.historyRef.current;
    const step = undoStep(history);
    if (step === null) return;
    const entry = history.entries[history.cursor - 1];
    const restores = entry?.restores ?? 'layout';
    layout.history.replace(step.history);
    if (step.sizes !== undefined) { layout.placement.previewSizes(step.sizes, layout.saver.desiredSizes.current); layout.saver.intendSizes(step.sizes); }
    if (step.connections !== undefined) { layout.previewConnections(step.connections); layout.saver.intendConnections(step.connections); }
    // A transition-only step must not replay the shown snapshot as authored placement.
    if (restores === 'layout') reposition(step.positions, { ...(entry?.beforeLayout === undefined ? {} : { layout: entry.beforeLayout }), clearOverrides: true, immediate: true });
    else if (step.connections !== undefined) { layout.saver.cancelTimer(); layout.saver.saveNow(); }
    // A restored connection keeps its stored route, so the layout save it just queued has
    // to reach the queue before the transitions are restored.
    const transitions = step.transitions;
    // A layout that could not be restored stops the replay: the transitions a step carries
    // belong on top of that layout, not over whatever the store kept.
    if (transitions !== undefined) void layout.saver.flush().then(() => actions.restore(transitions), () => undefined);
  }, [actions, layout, lock.locked, reposition]);

  const redo = useCallback(() => {
    if (lock.locked) return;
    const history = layout.history.historyRef.current;
    const step = redoStep(history);
    if (step === null) return;
    const entry = history.entries[history.cursor];
    const restores = entry?.restores ?? 'layout';
    layout.history.replace(step.history);
    if (step.sizes !== undefined) { layout.placement.previewSizes(step.sizes, layout.saver.desiredSizes.current); layout.saver.intendSizes(step.sizes); }
    if (step.connections !== undefined) { layout.previewConnections(step.connections); layout.saver.intendConnections(step.connections); }
    if (restores === 'layout') reposition(step.positions, { ...(entry?.afterLayout === undefined ? {} : { layout: entry.afterLayout }), clearOverrides: true, immediate: true });
    else if (step.connections !== undefined) { layout.saver.cancelTimer(); layout.saver.saveNow(); }
    const transitions = step.transitions;
    if (transitions !== undefined) void layout.saver.flush().then(() => actions.restore(transitions), () => undefined);
  }, [actions, layout, lock.locked, reposition]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, [role="dialog"]') !== null;
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace') && selectedConnectionId !== null && !lock.locked) {
        event.preventDefault();
        const connection = connectionsRef.current.find(value => value.id === selectedConnectionId);
        setSelectedConnectionId(null);
        if (connection !== undefined) actionsRef.current.remove(connection.from, connection.to);
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      if (editing) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lock.locked, redo, selectedConnectionId, undo]);

  // The transit is planned from the cards the diagram presents, so it begins when the
  // card actually moves on screen; the optimistic placement included. A host that
  // cannot run it, or a reduced-motion preference, settles the arrangement instead.
  const motionPort = useMemo(() => props.motionPreference ?? HOST_MOTION_PREFERENCE, [props.motionPreference]);
  // The preference is observed, not sampled: a change while a flight runs settles it
  // even when nothing else re-renders the diagram.
  const reducedMotion = useReducedMotion(motionPort);
  const capabilityRead = props.supportsTransit ?? supportsPathMotion;
  const settled = reducedMotion || !capabilityRead();
  const arrivals = useArrivals();
  const { arrive: arriveAt, settle: settleArrival, retain: retainArrivals, clear: clearArrivals } = arrivals;
  const transit = useTransit({
    tasks: diagramTasks,
    scene,
    resetKey: props.boardId,
    reducedMotion,
    supported: capabilityRead(),
    onArrive: arriveAt,
  });
  // A pulse belongs to a card the diagram presents, so a card that leaves the
  // presented cards takes its pulse with it instead of replaying it on return.
  const presentedKey = useMemo(() => diagramTasks.map(task => task.id).join('|'), [diagramTasks]);
  useEffect(() => {
    retainArrivals(new Set(presentedKey === '' ? [] : presentedKey.split('|')));
  }, [presentedKey, retainArrivals]);
  // An arrangement that settles without motion presents no arrival pulse at all.
  useEffect(() => {
    if (settled) clearArrivals();
  }, [settled, clearArrivals]);

  const initialColumnId = presented.initialColumnId;
  const stages: CanvasStage[] = scene.nodes.map(node => {
    const size = layout.stageSizeOf(node.id);
    return { id: node.id, label: node.name, x: node.position.x, y: node.position.y, width: size.width, height: size.height, cardIds: node.tasks.map(task => task.id), creatable: node.id === initialColumnId };
  });
  const connections: CanvasConnection[] = scene.edges.map(edge => {
    const authored = presentedRules(presented, edge.from);
    const rule = authored?.find(value => value.to === edge.to);
    const definition = presented.columns.find(column => column.id === edge.from)?.deterministic;
    const connection = layout.connectionLayouts[connectionKey(edge.from, edge.to)];
    return {
      id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, returning: edge.returning, fanOut: edge.fanOut, fanOutCount: edge.fanOutCount,
      ...(rule?.when === undefined ? {} : { condition: rule.when }),
      ...(definition === undefined ? {} : { deterministic: true }),
      ...(connection?.source === undefined ? {} : { source: connection.source }),
      ...(connection?.target === undefined ? {} : { target: connection.target }),
      ...(connection?.segments === undefined ? {} : { segments: connection.segments }),
    };
  });
  connectionsRef.current = connections;

  const tasksById = useMemo(() => new Map(props.state.tasks.map(task => [task.id, task])), [props.state.tasks]);
  const columnsById = useMemo(() => new Map(presented.columns.map(column => [column.id, column])), [presented.columns]);
  const cardEnvironment = useMemo<CardEnvironment>(() => ({
    renderCard(taskId: string) {
      const task = tasksById.get(taskId);
      if (task === undefined) return null;
      const column = columnsById.get(task.columnId);
      if (column === undefined) return null;
      const arrivalToken = arrivals.tokens.get(task.id);
      return <BoardCard
        task={task}
        column={column}
        projectName={props.card.projectNames.get(task.projectId) ?? task.projectId}
        attention={props.card.attention[task.id] ?? EMPTY_ATTENTION}
        workflow={presented}
        selectionMode={props.card.selectionMode}
        selected={props.card.selectedIds.has(task.id)}
        autoRun={props.card.autoRun}
        autoModePending={props.card.autoModePending.has(task.id)}
        onToggleAutoMode={props.card.onToggleAutoMode}
        onOpen={props.onOpenTask}
        onToggleSelect={props.card.onToggleSelect}
        onBeginDrag={props.beginDrag}
        shouldSuppressClick={props.shouldSuppressClick}
        advancePending={props.card.advancePending.has(task.id)}
        onRun={props.card.onRun}
        onMoveTask={props.card.onAdvance}
        onArrivalEnd={settleArrival}
        {...(arrivalToken === undefined ? {} : { arrivalToken })}
      />;
    },
  }), [tasksById, columnsById, props.card, presented, props.onOpenTask, props.beginDrag, props.shouldSuppressClick, arrivals.tokens, settleArrival]);

  const openCondition = useCallback((connectionId: string, anchor: ConditionAnchor) => {
    const connection = connectionsRef.current.find(value => value.id === connectionId);
    if (connection && presented.columns.find(column => column.id === connection.from)?.deterministic) { props.onEditStage?.(connection.from); return; }
    setSelectedConnectionId(connectionId);
    setConditionEditor({ connectionId, anchor });
  }, [presented, props.onEditStage]);

  const editorConnection = conditionEditor === null ? undefined : connections.find(value => value.id === conditionEditor.connectionId);

  const saveCondition = useCallback(async (text: string) => {
    const connection = conditionEditor === null ? undefined : connectionsRef.current.find(value => value.id === conditionEditor.connectionId);
    if (connection === undefined) { setConditionEditor(null); return; }
    try {
      await actionsRef.current.setCondition(connection.from, connection.to, text);
      setConditionEditor(null);
    } catch {
      // The editor stays open with its text and shows the problem the write reported.
    }
  }, [conditionEditor]);

  const deleteConnection = useCallback(() => {
    if (lock.locked) return;
    const connection = conditionEditor === null ? undefined : connectionsRef.current.find(value => value.id === conditionEditor.connectionId);
    setConditionEditor(null);
    setSelectedConnectionId(null);
    if (connection !== undefined) actionsRef.current.remove(connection.from, connection.to);
  }, [conditionEditor, lock.locked]);

  return <div className="kb-flow-shell" role="region" aria-label="Workflow diagram" tabIndex={-1}>
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
        ...(props.onCreateTask === undefined ? {} : { onCreateTask: props.onCreateTask }),
        ...(props.onEditStage === undefined ? {} : { onEditStage: props.onEditStage }),
      }}
      cardEnvironment={cardEnvironment}
      drop={{ stageId: props.drag?.overColumnId ?? null, indicatorY: props.drag?.overColumnId === undefined ? null : props.drag.indicatorY }}
      selectedConnectionId={selectedConnectionId}
      {...(transit.transits.length === 0 ? {} : { overlay: <TransitLayer transits={transit.transits} onArrived={transit.arrive} /> })}
      controls={viewport => <ViewControls
        locked={lock.locked}
        canUndo={canUndo(layout.history.history)}
        canRedo={canRedo(layout.history.history)}
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
      onSelectConnection={setSelectedConnectionId}
      onOpenCondition={openCondition}
      onCreateConnection={(sourceId, to, side) => actions.create(sourceId, to, side)}
      onRepointConnection={(sourceId, from, to) => actions.repoint(sourceId, from, to)}
      onReownConnection={(fromSource, to, toSource) => actions.reown(fromSource, to, toSource)}
    />
    {conditionEditor !== null && editorConnection !== undefined && <ConditionPopover
      anchor={conditionEditor.anchor}
      title={'Condition from ' + (presented.columns.find(column => column.id === editorConnection.from)?.name ?? editorConnection.from) + ' to ' + (presented.columns.find(column => column.id === editorConnection.to)?.name ?? editorConnection.to)}
      value={editorConnection.condition ?? ''}
      pending={actions.pending}
      locked={lock.locked}
      problem={actions.error}
      onSave={text => { void saveCondition(text); }}
      onDelete={deleteConnection}
      onClose={() => { actions.clearError(); setConditionEditor(null); }}
    />}
  </div>;
}
