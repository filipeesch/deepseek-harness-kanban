import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider, Panel, ViewportPortal, applyNodeChanges,
  useReactFlow, type Edge, type EdgeTypes, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import flowStyles from '@xyflow/react/dist/style.css';
import { sameAnchor } from '../../domain/connection-anchor.js';
import { ConnectionEdgeView, pathMidpoint } from './connection-edge.js';
import { DiagramMinimap } from './controls/minimap.js';
import { StageCallbacksContext, StageDragContext, StageNodeView, type StageCallbacks } from './stage-node.js';
import { CardEnvironmentContext } from './card-environment.js';
import type { GestureHandle, PointerEventsPort } from './gestures/stage-drag.js';
import { FLOW_ZOOM, clampZoom, markScale, nextZoom, zoomAroundPoint, type Viewport } from './gestures/viewport-policy.js';
import { edgeModel, type LiveStageRect } from './edge-model.js';
import type { DiagramPoint } from './routing/orthogonal.js';
import { ConnectionHandlersContext, type ConnectionHandlers } from './connection-interaction.js';
import { boardConnectionDropResolver, type ConnectionDropResolver } from './connection-drop.js';
import { useConnectionGestures } from './use/use-connection-gestures.js';
import { useStageDrag } from './use/use-stage-drag.js';
import { stageSignature, toNode, type CanvasStage, type StageFlowNode } from './canvas-stage.js';
import type { CanvasConnection, CanvasDropState, CanvasViewportActions, CanvasViewRequest, ConnectionEdit } from './canvas-types.js';
import type { StageSide } from '../../shared/types.js';

export type { CanvasStage, CanvasConnection, CanvasViewRequest, ConnectionEdit, CanvasViewportActions } from './canvas-types.js';

/** Where the condition editor should sit, in client coordinates. */
export interface ConditionAnchor { readonly x: number; readonly y: number }

export interface WorkflowCanvasProps {
  readonly stages: readonly CanvasStage[];
  readonly connections: readonly CanvasConnection[];
  /** False until every stage has been measured, so the first paint never jumps. */
  readonly ready: boolean;
  /** How the surface places the diagram; see CanvasViewRequest. */
  readonly viewRequest: CanvasViewRequest;
  /** Changes when a new request must be applied, even when it repeats the same intent. */
  readonly viewToken: number;
  /** The position the diagram settled on; the parent stores it for the active board. */
  readonly onViewportChange?: (viewport: Viewport) => void;
  /** The layout lock; a locked diagram never starts a layout or connection gesture. */
  readonly locked: boolean;
  /** The lattice every layout gesture settles on. */
  readonly snap: import('./canvas-types.js').SnapPolicy;
  readonly callbacks: StageCallbacks;
  readonly cardEnvironment: import('./canvas-types.js').CardEnvironment;
  /** The stage and insertion line under an active card drag. */
  readonly drop: CanvasDropState;
  /** The connection the diagram presents as selected. */
  readonly selectedConnectionId: string | null;
  readonly overlay?: React.ReactNode;
  /** The view supplies the control stack; the surface supplies its viewport actions. */
  readonly controls?: (viewport: CanvasViewportActions) => React.ReactNode;
  readonly onStageMove: (stageId: string, position: { x: number; y: number }) => void;
  readonly onStageResize: (stageId: string, size: { width: number; height: number }) => void;
  readonly onStageResizeEnd: (stageId: string, size: { width: number; height: number }) => void;
  readonly onStageResizeCancel: (stageId: string) => void;
  /** Called once per completed arrow adjustment. */
  readonly onConnectionEdit: (edit: ConnectionEdit) => void;
  /** Called when a connection is selected or the selection is cleared. */
  readonly onSelectConnection: (connectionId: string | null) => void;
  /** Called when a connection's condition should be edited, with where to anchor the editor. */
  readonly onOpenCondition: (connectionId: string, anchor: ConditionAnchor) => void;
  /** Called once when a new connection is drawn onto another stage. */
  readonly onCreateConnection: (sourceId: string, to: string, side: StageSide) => void;
  /** Called once when an end is released over another stage, re-pointing the transition. */
  readonly onRepointConnection: (sourceId: string, from: string, to: string) => void;
  /** Called once when a source end is released over another stage, moving the transition. */
  readonly onReownConnection: (fromSource: string, to: string, toSource: string) => void;
  /** The stage hit test; a harness substitutes it. */
  readonly dropResolver?: ConnectionDropResolver;
}

export type WorkflowCanvasComponent = React.ComponentType<WorkflowCanvasProps>;

const nodeTypes = { stage: StageNodeView } as unknown as NodeTypes;
const edgeTypes = { connection: ConnectionEdgeView } as unknown as EdgeTypes;

function rectOf(stage: LiveStageRect) {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

/** The line drawn while a connection is being created, from its stage to the pointer. */
function CreationPreview({ from, to }: { readonly from: DiagramPoint; readonly to: DiagramPoint }) {
  return <g className="kb-flow-creation" aria-hidden="true">
    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
    <circle cx={to.x} cy={to.y} r={4} />
  </g>;
}

function CanvasInner(props: WorkflowCanvasProps) {
  const instance = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const resolver = useRef<ConnectionDropResolver>(props.dropResolver ?? boardConnectionDropResolver());
  resolver.current = props.dropResolver ?? resolver.current;
  const [nodes, setNodes] = React.useState<StageFlowNode[]>(() => props.stages.map(stage => toNode(stage, props.locked)));

  const signature = useMemo(() => stageSignature(props.stages, props.locked), [props.stages, props.locked]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const stageDrag = useStageDrag({
    locked: props.locked,
    zoom: () => instance.getZoom(),
    events: document as unknown as PointerEventsPort,
    snap: props.snap,
    positionOf: stageId => nodesRef.current.find(node => node.id === stageId)?.position,
    preview: (stageId, position) => setNodes(current => current.map(node => node.id === stageId ? { ...node, position } : node)),
    commit: (stageId, position) => props.onStageMove(stageId, position),
  });

  useEffect(() => {
    // A running gesture owns the node positions; the committed stages replace them
    // only once it has finished.
    if (stageDrag.isDragging()) return;
    setNodes(current => {
      const measured = new Map(current.map(node => [node.id, node.measured]));
      return props.stages.map(stage => toNode(stage, props.locked, measured.get(stage.id)));
    });
  }, [signature]);

  const onNodesChange = useCallback((changes: NodeChange<StageFlowNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
  }, []);

  useEffect(() => {
    if (!props.ready) return undefined;
    if (props.viewRequest.kind === 'restore') {
      const { x, y, zoom } = props.viewRequest.viewport;
      void instance.setViewport({ x, y, zoom: clampZoom(zoom) }, { duration: 0 });
      return undefined;
    }
    const frame = requestAnimationFrame(() => { void instance.fitView({ padding: 0.2, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [props.ready, props.viewToken, instance]);

  const liveStages = useMemo<LiveStageRect[]>(() => nodes.map(node => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.data.width,
    height: node.measured?.height ?? node.data.height,
  })), [nodes]);

  const flowPoint = useCallback((client: { readonly clientX: number; readonly clientY: number }) => instance.screenToFlowPosition({ x: client.clientX, y: client.clientY }), [instance]);
  /** The stage a gesture would land on, resolved through the board's own hit test. */
  const resolveStage = useCallback((client: { readonly clientX: number; readonly clientY: number }) => resolver.current.resolve(client), []);
  const stageLabel = useCallback((stageId: string) => nodesRef.current.find(node => node.id === stageId)?.data.label ?? stageId, []);

  const gestures = useConnectionGestures({
    locked: props.locked,
    snap: props.snap,
    connections: props.connections,
    stages: liveStages,
    stageLabel,
    flowPoint,
    resolveStage,
    onConnectionEdit: props.onConnectionEdit,
    onCreate: props.onCreateConnection,
    onRepoint: props.onRepointConnection,
    onReown: props.onReownConnection,
  });

  const edges = useMemo<Edge[]>(() => edgeModel(liveStages, props.connections.map(gestures.present)).map(edge => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'connection',
    data: { path: edge.path, points: edge.points, tipAngle: edge.tipAngle, kind: edge.kind, returning: edge.returning, lines: edge.lines, hasCondition: edge.condition !== undefined },
    selectable: false,
    focusable: false,
  })), [liveStages, props.connections, gestures]);

  /** Where the editor for one connection should sit: the middle of the arrow it edits. */
  const openCondition = useCallback((connectionId: string) => {
    const connection = props.connections.find(value => value.id === connectionId);
    const edge = connection === undefined ? undefined : edgeModel(liveStages, [gestures.present(connection)])[0];
    const middle = edge === undefined ? undefined : pathMidpoint(edge.points);
    const screen = instance.flowToScreenPosition(middle ?? { x: 0, y: 0 });
    props.onOpenCondition(connectionId, { x: screen.x, y: screen.y });
  }, [gestures, instance, liveStages, props.connections, props.onOpenCondition]);

  const handlers = useMemo<ConnectionHandlers>(() => ({
    ...gestures.handlers,
    selectedId: props.selectedConnectionId,
    onSelect: connectionId => props.onSelectConnection(connectionId),
    onEditCondition: openCondition,
  }), [gestures.handlers, openCondition, props.onSelectConnection, props.selectedConnectionId]);

  // The card's attention marks counter-scale against the published zoom. Writing one
  // custom property keeps the diagram out of the card's contract and avoids a card
  // re-render on every zoom step.
  const publishMarkScale = useCallback((zoom: number) => {
    wrapper.current?.style.setProperty('--kb-mark-scale', String(markScale(zoom)));
  }, []);

  const zoomBy = useCallback((direction: 'in' | 'out') => {
    const element = wrapper.current;
    if (element === null) return;
    const current = instance.getViewport();
    const rect = element.getBoundingClientRect();
    const zoom = nextZoom(current.zoom, direction);
    void instance.setViewport(zoomAroundPoint(current, { x: rect.width / 2, y: rect.height / 2 }, zoom), { duration: 120 });
  }, [instance]);

  const viewport = useMemo<CanvasViewportActions>(() => ({
    zoomIn: () => zoomBy('in'),
    zoomOut: () => zoomBy('out'),
    fit: () => { void instance.fitView({ padding: 0.2, duration: 120 }); },
  }), [instance, zoomBy]);

  const callbacks = useMemo<StageCallbacks>(() => ({
    ...props.callbacks,
    snap: props.snap,
    onStagePointerDown: stageDrag.start,
    onStageResize: props.onStageResize,
    onStageResizeEnd: props.onStageResizeEnd,
    onStageResizeCancel: props.onStageResizeCancel,
    ...(props.locked ? {} : { onBeginConnect: gestures.beginCreation }),
    editDisabled: props.locked,
  }), [props.callbacks, stageDrag.start, props.snap, props.onStageResize, props.onStageResizeEnd, props.onStageResizeCancel, props.locked, gestures.beginCreation]);

  const dragState = useMemo(() => ({ stageId: props.drop.stageId, indicatorY: props.drop.indicatorY, candidateStageId: gestures.candidateStageId }), [props.drop.stageId, props.drop.indicatorY, gestures.candidateStageId]);

  // Pressing anything that is not a connection clears the selection, so the selection
  // never survives a press somewhere else in the diagram.
  const clearSelectionOutside = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target !== null && target.closest('[data-connection-id]') !== null) return;
    props.onSelectConnection(null);
  }, [props.onSelectConnection]);

  return <div ref={wrapper} className="kb-flow-canvas" data-ready={props.ready ? 'true' : 'false'} data-locked={props.locked ? 'true' : 'false'} onPointerDownCapture={clearSelectionOutside}>
    <style>{flowStyles}</style>
    <CardEnvironmentContext.Provider value={props.cardEnvironment}>
      <StageCallbacksContext.Provider value={callbacks}>
        <ConnectionHandlersContext.Provider value={handlers}>
          <StageDragContext.Provider value={dragState}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              // React Flow assigns pointer events to a node only when it is interactive;
              // this no-op click keeps the stage content hittable without selecting it.
              onNodeClick={() => undefined}
              onPaneClick={() => props.onSelectConnection(null)}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              zoomOnScroll
              panOnScroll={false}
              zoomOnPinch
              panOnDrag
              minZoom={FLOW_ZOOM.min}
              maxZoom={FLOW_ZOOM.max}
              fitView={false}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              onMove={(_event, next) => { publishMarkScale(next.zoom); }}
              onMoveEnd={(_event, next) => props.onViewportChange?.({ x: next.x, y: next.y, zoom: next.zoom })}
            >
              {props.controls !== undefined && <Panel position="bottom-left">{props.controls(viewport)}</Panel>}
              <DiagramMinimap />
              {props.overlay !== undefined && <ViewportPortal>{props.overlay}</ViewportPortal>}
              {gestures.creation !== null && <ViewportPortal><CreationPreview from={gestures.creation.from} to={gestures.creation.to} /></ViewportPortal>}
            </ReactFlow>
          </StageDragContext.Provider>
        </ConnectionHandlersContext.Provider>
      </StageCallbacksContext.Provider>
    </CardEnvironmentContext.Provider>
  </div>;
}

/** The React Flow surface: controlled stage nodes, drawn connections, pan and zoom. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
