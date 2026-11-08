import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attention, BoardState, StagePosition, Task } from '../../shared/types.js';
import { EMPTY_ATTENTION } from '../../shared/types.js';
import { placementIndex } from '../../domain/placement.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../../domain/workflow-positions.js';
import { prefersReducedMotion } from '../card-motion/preference.js';
import type { RunCommand } from '../ui.js';
import type { CardDragState } from '../useCardDrag.js';
import type { OptimisticMove } from '../useMoveRequest.js';
import { WorkflowCanvas, type CanvasConnection, type CanvasStage, type WorkflowCanvasComponent } from './canvas.js';
import type { FlowCard, StageCallbacks } from './stage-node.js';
import { buildWorkflowScene } from './scene.js';
import { computeAutoLayout, freezeAutoLayout, graphKey, mergePlacements, samePosition, type FrozenAutoLayout } from './placement.js';
import { placementBounds, type StageLayout } from './layout.js';
import { canRedo, canUndo, emptyHistory, pushStep, redoStep, undoStep, type PlacementHistory, type PlacementStep } from './history.js';
import { planTravel } from './travel.js';
import { TravelLayer, type TravelMoveView } from './travel-layer.js';
import type { StageSize } from './layout.js';

/** How long a drag waits before it stores the workflow; one drag, one save. */
export const PLACEMENT_SAVE_DELAY_MS = 400;

export interface WorkflowViewProps {
  hubId: string;
  boardId: string;
  state: BoardState;
  /** The cards the board shows for the active search and project filter. */
  tasks: readonly Task[];
  attention: Record<string, Attention>;
  optimistic: OptimisticMove | null;
  drag: CardDragState | null;
  beginDrag: (event: React.PointerEvent<HTMLElement>, taskId: string, columnId: string) => void;
  shouldSuppressClick: () => boolean;
  run: RunCommand;
  /** Hub revision used as the workflow save precondition. */
  revision: number;
  onOpenTask: (taskId: string) => void;
  onError: (error: unknown) => void;
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
 * state only: measured stage sizes, frozen automatic placement, manual
 * overrides, the placement history, and the card travel. Every move still runs
 * through the board's move pipeline, and every placement change is a workflow
 * save.
 */
export function WorkflowView(props: WorkflowViewProps) {
  const stateRef = useRef(props.state); stateRef.current = props.state;
  const revisionRef = useRef(props.revision); revisionRef.current = props.revision;
  const errorRef = useRef(props.onError); errorRef.current = props.onError;
  const Canvas = props.canvas ?? WorkflowCanvas;

  const [measured, setMeasured] = useState<Map<string, StageSize>>(() => new Map());
  const measuredRef = useRef(measured); measuredRef.current = measured;
  const [revealed, setRevealed] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, StagePosition>>({});
  const overridesRef = useRef(overrides); overridesRef.current = overrides;
  const [history, setHistory] = useState<PlacementHistory>(emptyHistory);
  const historyRef = useRef(history); historyRef.current = history;
  const [travel, setTravel] = useState<readonly TravelMoveView[]>([]);
  const travelSerial = useRef(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const frozen = useRef<FrozenAutoLayout | null>(null);
  const previousStages = useRef<Map<string, string> | null>(null);
  const baselines = useRef<Record<string, StagePosition | undefined>>({});

  const workflowKey = useMemo(() => graphKey(props.state.workflow), [props.state.workflow]);
  const workflowKeyRef = useRef(workflowKey); workflowKeyRef.current = workflowKey;
  const stored = useMemo(() => readStagePositions(props.state.workflow), [props.state.workflow]);
  const storedRef = useRef(stored); storedRef.current = stored;

  const lastWorkflowKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastWorkflowKey.current === workflowKey) return;
    const first = lastWorkflowKey.current === null;
    lastWorkflowKey.current = workflowKey;
    frozen.current = null;
    // A structural change normally resizes at least one stage, but a new stage at a
    // default size must still be measured before the diagram is shown again.
    if (!first) setRevealed(false);
  }, [workflowKey]);

  useEffect(() => {
    if (revealed) return;
    if (props.state.workflow.columns.every(column => measured.has(column.id))) setRevealed(true);
  }, [measured, revealed, props.state.workflow.columns]);

  useEffect(() => {
    if (!revealed) return;
    setFitRequest(value => value + 1);
  }, [revealed]);

  const onMeasure = useCallback((stageId: string, size: StageSize) => {
    setMeasured(current => {
      const existing = current.get(stageId);
      if (existing !== undefined && existing.width === size.width && existing.height === size.height) return current;
      const next = new Map(current);
      next.set(stageId, { width: size.width, height: size.height });
      return next;
    });
  }, []);

  const autoLayout = useMemo(() => {
    const compute = () => computeAutoLayout(props.state.workflow, measured);
    if (!revealed) return compute();
    const frozenLayout = freezeAutoLayout(frozen.current, workflowKey, compute);
    frozen.current = frozenLayout;
    return frozenLayout.layout;
  }, [props.state.workflow, workflowKey, measured, revealed, layoutVersion]);

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

  const visualPositions = useCallback((): Record<string, StagePosition> => {
    const result: Record<string, StagePosition> = {};
    for (const [id, position] of placementsRef.current) result[id] = { x: position.x, y: position.y };
    return result;
  }, []);

  const layoutFrom = useCallback((positions: StagePositions): StageLayout => {
    const map = new Map<string, StagePosition>();
    for (const [id, position] of Object.entries(positions)) if (position !== undefined) map.set(id, position);
    return { placements: map, bounds: placementBounds(map, measuredRef.current) };
  }, []);
  const diagramTasks = useMemo(() => applyOptimistic(props.tasks, props.optimistic), [props.tasks, props.optimistic]);
  const scene = useMemo(() => buildWorkflowScene({ workflow: props.state.workflow, tasks: diagramTasks, placements, sizes: measured }), [props.state.workflow, diagramTasks, placements, measured]);

  const projectNames = useMemo(() => new Map(props.state.projects.map(project => [project.id, project.name])), [props.state.projects]);
  const cardOf = useCallback((task: Task): FlowCard => {
    const attention = props.attention[task.id] ?? EMPTY_ATTENTION;
    return {
      id: task.id,
      title: task.title,
      projectName: projectNames.get(task.projectId) ?? task.projectId,
      running: attention.running,
      unread: attention.unread,
      failed: attention.failed,
    };
  }, [props.attention, projectNames]);

  const stages: CanvasStage[] = scene.nodes.map(node => ({
    id: node.id,
    label: node.name,
    x: node.position.x,
    y: node.position.y,
    cards: node.tasks.map(cardOf),
  }));
  const connections: CanvasConnection[] = scene.edges.map(edge => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    path: edge.shape.path,
    points: edge.shape.points,
    kind: edge.kind,
    returning: edge.returning,
  }));

  const callbacks = useMemo<StageCallbacks>(() => ({
    onOpenCard: props.onOpenTask,
    onCardPointerDown: (event, taskId, stageId) => props.beginDrag(event, taskId, stageId),
    shouldSuppressClick: props.shouldSuppressClick,
    onMeasure,
  }), [props.onOpenTask, props.beginDrag, props.shouldSuppressClick, onMeasure]);

  // Placement edits compose against the text this view intends to persist, never
  // against the last acknowledged snapshot: an Undo that follows an already
  // dispatched save must queue a compensating save instead of becoming a no-op.
  const desiredYaml = useRef<string | null>(null);
  const desiredPositions = useRef<Record<string, StagePosition>>(Object.create(null) as Record<string, StagePosition>);
  const sentYaml = useRef<string | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Adopt an acknowledged workflow only while no local placement is unsaved.
    if (desiredYaml.current !== null && desiredYaml.current !== sentYaml.current) return;
    desiredYaml.current = props.state.workflowYaml;
    sentYaml.current = props.state.workflowYaml;
    desiredPositions.current = readStagePositions(props.state.workflow);
  }, [props.state.workflowYaml, props.state.workflow]);

  const cancelSaveTimer = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  const runSave = useCallback(async (): Promise<void> => {
    if (saving.current) { queued.current = true; return; }
    const text = desiredYaml.current;
    if (text === null || text === sentYaml.current) return;
    saving.current = true;
    try {
      const result = await props.run({ type: 'board.workflow.save', hubId: props.hubId, boardId: props.boardId, yaml: text, expectedRevision: revisionRef.current });
      sentYaml.current = text;
      const hubRevision = result.state?.hubs.find(hub => hub.id === props.hubId)?.revision;
      if (typeof hubRevision === 'number') revisionRef.current = hubRevision;
    } catch (error) {
      // The placement is not persisted: return to the acknowledged workflow and
      // drop the pending visual and history state that belonged to it.
      desiredYaml.current = stateRef.current.workflowYaml;
      sentYaml.current = desiredYaml.current;
      desiredPositions.current = readStagePositions(stateRef.current.workflow);
      setOverrides({});
      frozen.current = null;
      setLayoutVersion(value => value + 1);
      setHistory(emptyHistory());
      errorRef.current(error);
    } finally {
      saving.current = false;
    }
    if (queued.current) { queued.current = false; void runSave(); return; }
    if (desiredYaml.current !== null && desiredYaml.current !== sentYaml.current) void runSave();
  }, [props.hubId, props.boardId, props.run]);

  const queueSave = useCallback(() => {
    cancelSaveTimer();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void runSave();
    }, PLACEMENT_SAVE_DELAY_MS);
  }, [cancelSaveTimer, runSave]);

  // A completed drag is already a user decision: send it before the view goes away.
  useEffect(() => () => { cancelSaveTimer(); void runSave(); }, [cancelSaveTimer, runSave]);

  const pushHistory = useCallback((step: PlacementStep) => {
    setHistory(current => pushStep(current, step));
  }, []);

  /** Replace the intended placement and its authored text with a complete map. */
  const intend = useCallback((positions: StagePositions) => {
    const next: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
    for (const [id, position] of Object.entries(positions)) if (position !== undefined) next[id] = { x: position.x, y: position.y };
    desiredPositions.current = next;
    desiredYaml.current = setStagePositions(desiredYaml.current ?? stateRef.current.workflowYaml, next);
  }, []);

  const reposition = useCallback((positions: StagePositions, options: { readonly layout?: StagePositions; readonly clearOverrides: boolean; readonly immediate: boolean }) => {
    if (options.clearOverrides) setOverrides({});
    if (options.layout !== undefined) {
      frozen.current = { key: workflowKeyRef.current, layout: layoutFrom(options.layout) };
      setLayoutVersion(value => value + 1);
    }
    intend(positions);
    cancelSaveTimer();
    if (options.immediate) void runSave(); else queueSave();
  }, [cancelSaveTimer, intend, layoutFrom, queueSave, runSave]);

  const moveStage = useCallback((stageId: string, position: { x: number; y: number }) => {
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    const before: Record<string, StagePosition> = { ...desiredPositions.current };
    const after: Record<string, StagePosition> = { ...before, [stageId]: rounded };
    const beforeLayout = visualPositions();
    const afterLayout: Record<string, StagePosition> = { ...beforeLayout, [stageId]: rounded };
    const nextBaselines = Object.create(null) as Record<string, StagePosition | undefined>;
    Object.assign(nextBaselines, baselines.current, { [stageId]: storedRef.current[stageId] });
    baselines.current = nextBaselines;
    setOverrides(current => ({ ...current, [stageId]: rounded }));
    pushHistory({ before, after, beforeLayout, afterLayout });
    reposition(after, { clearOverrides: false, immediate: false });
  }, [pushHistory, reposition, visualPositions]);

  const organize = useCallback(() => {
    const layout = computeAutoLayout(stateRef.current.workflow, measuredRef.current);
    const next: Record<string, StagePosition> = Object.create(null) as Record<string, StagePosition>;
    for (const [id, position] of layout.placements) next[id] = { x: Math.round(position.x), y: Math.round(position.y) };
    const before: Record<string, StagePosition> = { ...desiredPositions.current };
    const beforeLayout = visualPositions();
    frozen.current = { key: graphKey(stateRef.current.workflow), layout };
    setLayoutVersion(value => value + 1);
    pushHistory({ before, after: next, beforeLayout, afterLayout: next });
    reposition(next, { clearOverrides: true, immediate: true });
    setFitRequest(value => value + 1);
  }, [pushHistory, reposition, visualPositions]);

  const undo = useCallback(() => {
    const current = historyRef.current;
    const step = undoStep(current);
    if (step === null) return;
    const entry = current.entries[current.cursor - 1];
    setHistory(step.history);
    reposition(step.positions, { ...(entry?.beforeLayout === undefined ? {} : { layout: entry.beforeLayout }), clearOverrides: true, immediate: true });
  }, [reposition]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    const step = redoStep(current);
    if (step === null) return;
    const entry = current.entries[current.cursor];
    setHistory(step.history);
    reposition(step.positions, { ...(entry?.afterLayout === undefined ? {} : { layout: entry.afterLayout }), clearOverrides: true, immediate: true });
  }, [reposition]);

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

  const stagesKey = useMemo(() => props.state.tasks.map(task => task.id + ':' + task.columnId).join('|'), [props.state.tasks]);
  const visibleKey = useMemo(() => props.tasks.map(task => task.id).join('|'), [props.tasks]);
  useEffect(() => {
    const current = new Map(props.state.tasks.map(task => [task.id, task.columnId]));
    const before = previousStages.current;
    previousStages.current = current;
    if (before === null || prefersReducedMotion()) return;
    // Only cards the active search and project filter present may travel.
    const committed = buildWorkflowScene({ workflow: props.state.workflow, tasks: props.tasks, placements, sizes: measured });
    const moves = planTravel({ previousStageByTask: before, tasks: props.tasks, scene: committed });
    if (moves.length === 0) {
      setTravel(currentTravel => currentTravel.length === 0 ? currentTravel : []);
      return;
    }
    const titles = new Map(props.tasks.map(task => [task.id, task.title]));
    setTravel(moves.map(move => ({
      id: move.taskId + ':' + (travelSerial.current += 1),
      title: titles.get(move.taskId) ?? move.taskId,
      points: move.points,
    })));
  }, [stagesKey, visibleKey]);

  const finishTravel = useCallback(() => setTravel([]), []);

  return <div className="kb-flow-shell" role="region" aria-label="Workflow diagram">
    <div className="kb-flow-toolbar" role="group" aria-label="Diagram actions">
      <button type="button" className="kb-button" onClick={organize}>Organize</button>
      <button type="button" className="kb-button" disabled={!canUndo(history)} onClick={undo}>Undo</button>
      <button type="button" className="kb-button" disabled={!canRedo(history)} onClick={redo}>Redo</button>
    </div>
    <Canvas
      stages={stages}
      connections={connections}
      ready={revealed}
      fitRequest={fitRequest}
      callbacks={callbacks}
      dropStageId={props.drag?.overColumnId ?? null}
      dropIndicatorY={props.drag?.overColumnId === undefined ? null : props.drag.indicatorY}
      {...(travel.length === 0 ? {} : { overlay: <TravelLayer moves={travel} onFinished={finishTravel} /> })}
      onStageMove={moveStage}
    />
  </div>;
}
