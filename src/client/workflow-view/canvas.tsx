import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Panel, ViewportPortal, applyNodeChanges,
  useReactFlow, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import flowStyles from '@xyflow/react/dist/style.css';
import type { ConnectionAnchor, ConnectionSegmentOffset } from '../../shared/types.js';
import { sameAnchor } from '../../domain/connection-anchor.js';
import { ConnectionEdgeView } from './connection-edge.js';
import { DiagramMinimap } from './controls/minimap.js';
import { StageCallbacksContext, StageDragContext, StageNodeView, type StageCallbacks, type StageNodeModel } from './stage-node.js';
import { CardEnvironmentContext, type CardEnvironment } from './card-environment.js';
import { beginStageDrag, type GestureHandle, type PointerEventsPort } from './gestures/stage-drag.js';
import { beginConnectionDrag, type KeyboardEventsPort } from './gestures/connection-drag.js';
import { FLOW_ZOOM, nextZoom, zoomAroundPoint } from './gestures/viewport-policy.js';
import { connectionRouteFor, edgeModel, type LiveConnectionDescriptor, type LiveStageRect } from './edge-model.js';
import { connectionRoute } from './routing/route.js';
import { nearestAnchor } from './routing/ports.js';
import type { DiagramPoint, DiagramRect } from './routing/orthogonal.js';
import { ConnectionHandlersContext, stepAnchor, type ConnectionEnd, type ConnectionHandlers } from './connection-interaction.js';

export interface CanvasStage {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** The minimum width the stage renders at. */
  readonly width: number;
  /** The minimum height the stage renders at. */
  readonly height: number;
  readonly cardIds: readonly string[];
}

/** One connection as the diagram draws it, with the authored layout already merged in. */
export type CanvasConnection = LiveConnectionDescriptor;

/** One connection adjustment the surface asks the view to store. */
export interface ConnectionEdit {
  readonly connectionId: string;
  readonly source?: ConnectionAnchor;
  readonly target?: ConnectionAnchor;
  readonly segments?: readonly ConnectionSegmentOffset[];
}

/** What the control stack can ask of the diagram surface. */
export interface CanvasViewportActions { zoomIn(): void; zoomOut(): void; fit(): void }

export interface WorkflowCanvasProps {
  readonly stages: readonly CanvasStage[];
  readonly connections: readonly CanvasConnection[];
  /** False until every stage has been measured, so the first paint never jumps. */
  readonly ready: boolean;
  /** Increment to frame the whole diagram. */
  readonly fitRequest: number;
  /** The layout lock; a locked diagram never starts a stage move, a resize, or an arrow adjustment. */
  readonly locked: boolean;
  readonly callbacks: StageCallbacks;
  readonly cardEnvironment: CardEnvironment;
  /** The stage and insertion line under an active card drag. */
  readonly dropStageId: string | null;
  readonly dropIndicatorY: number | null;
  readonly overlay?: React.ReactNode;
  /** The view supplies the control stack; the surface supplies its viewport actions. */
  readonly controls?: (viewport: CanvasViewportActions) => React.ReactNode;
  readonly onStageMove: (stageId: string, position: { x: number; y: number }) => void;
  readonly onStageResize: (stageId: string, size: { width: number; height: number }) => void;
  readonly onStageResizeEnd: (stageId: string, size: { width: number; height: number }) => void;
  readonly onStageResizeCancel: (stageId: string) => void;
  /** Called once per completed arrow adjustment. */
  readonly onConnectionEdit: (edit: ConnectionEdit) => void;
}

export type WorkflowCanvasComponent = React.ComponentType<WorkflowCanvasProps>;

type StageFlowNode = Node<StageNodeModel, 'stage'>;

const nodeTypes = { stage: StageNodeView } as unknown as NodeTypes;
const edgeTypes = { connection: ConnectionEdgeView } as unknown as EdgeTypes;

/** The connection layout a gesture previews before it is committed. */
interface ConnectionPreview {
  readonly source?: ConnectionAnchor;
  readonly target?: ConnectionAnchor;
  readonly segments?: readonly ConnectionSegmentOffset[];
}

function toNode(stage: CanvasStage, locked: boolean, measured?: StageFlowNode['measured']): StageFlowNode {
  return {
    id: stage.id,
    type: 'stage',
    position: { x: stage.x, y: stage.y },
    data: { id: stage.id, label: stage.label, cardIds: stage.cardIds, width: stage.width, height: stage.height, locked },
    style: { width: stage.width, minHeight: stage.height },
    draggable: false,
    selectable: false,
    ...(measured === undefined ? {} : { measured }),
  };
}

function rectOf(stage: LiveStageRect): DiagramRect {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

/** Replace the displacement of one axis at one position, keeping the others in order. */
function withOffset(segments: readonly ConnectionSegmentOffset[], axis: 'x' | 'y', order: number, offset: number): ConnectionSegmentOffset[] {
  const result = segments.map(segment => ({ axis: segment.axis, offset: segment.offset }));
  const positions: number[] = [];
  result.forEach((segment, index) => { if (segment.axis === axis) positions.push(index); });
  while (positions.length <= order) {
    result.push({ axis, offset: 0 });
    positions.push(result.length - 1);
  }
  result[positions[order]!] = { axis, offset };
  return result;
}

function previewPatch(values: Record<string, ConnectionPreview>, connectionId: string, end: ConnectionEnd, anchor: ConnectionAnchor): Record<string, ConnectionPreview> {
  const current = values[connectionId] ?? {};
  return { ...values, [connectionId]: end === 'source' ? { ...current, source: anchor } : { ...current, target: anchor } };
}

function CanvasInner(props: WorkflowCanvasProps) {
  const instance = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const drag = useRef<GestureHandle | null>(null);
  const connectionDrag = useRef<GestureHandle | null>(null);
  const keyboardSession = useRef<{ connectionId: string; end: ConnectionEnd } | null>(null);
  const [nodes, setNodes] = useState<StageFlowNode[]>(() => props.stages.map(stage => toNode(stage, props.locked)));
  const [preview, setPreview] = useState<Record<string, ConnectionPreview>>({});
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const signature = useMemo(() => JSON.stringify(props.stages.map(stage => [
    stage.id, stage.x, stage.y, stage.width, stage.height, stage.label, props.locked,
    stage.cardIds,
  ])), [props.stages, props.locked]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    // A running gesture owns the node positions; the committed stages replace
    // them only once it has finished.
    if (drag.current !== null) return;
    setNodes(current => {
      const measured = new Map(current.map(node => [node.id, node.measured]));
      return props.stages.map(stage => toNode(stage, props.locked, measured.get(stage.id)));
    });
  }, [signature]);

  useEffect(() => () => { drag.current?.dispose(); drag.current = null; connectionDrag.current?.dispose(); connectionDrag.current = null; }, []);

  const onNodesChange = useCallback((changes: NodeChange<StageFlowNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
  }, []);

  const startStageDrag = useCallback((event: React.PointerEvent<HTMLElement>, stageId: string) => {
    if (props.locked || event.button !== 0 || drag.current !== null) return;
    const stage = nodesRef.current.find(node => node.id === stageId);
    if (stage === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: stage.position.x, y: stage.position.y };
    drag.current = beginStageDrag({
      stageId,
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      origin,
      zoom: () => instance.getZoom(),
      events: document as unknown as PointerEventsPort,
      onMove: (id, position) => setNodes(current => current.map(candidate => candidate.id === id ? { ...candidate, position } : candidate)),
      onCommit: (id, position) => {
        drag.current = null;
        props.onStageMove(id, position);
      },
      onCancel: () => {
        drag.current = null;
        setNodes(current => current.map(candidate => candidate.id === stageId ? { ...candidate, position: origin } : candidate));
      },
    });
  }, [instance, props.locked, props.onStageMove]);

  useEffect(() => {
    if (!props.ready) return;
    const frame = requestAnimationFrame(() => { void instance.fitView({ padding: 0.2, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [props.ready, props.fitRequest, instance]);

  const liveStages = useMemo<LiveStageRect[]>(() => nodes.map(node => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.data.width,
    height: node.measured?.height ?? node.data.height,
  })), [nodes]);

  const connections = useMemo<readonly CanvasConnection[]>(() => props.connections.map(connection => {
    const override = preview[connection.id];
    if (override === undefined) return connection;
    return {
      ...connection,
      ...(override.source === undefined ? {} : { source: override.source }),
      ...(override.target === undefined ? {} : { target: override.target }),
      ...(override.segments === undefined ? {} : { segments: override.segments }),
    };
  }), [props.connections, preview]);

  const edges = useMemo<Edge[]>(() => edgeModel(liveStages, connections).map(edge => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'connection',
    data: { path: edge.path, points: edge.points, tipAngle: edge.tipAngle, kind: edge.kind, returning: edge.returning, lines: edge.lines },
    selectable: false,
    focusable: false,
  })), [liveStages, connections]);

  const connectionOf = useCallback((connectionId: string): CanvasConnection | undefined => connections.find(value => value.id === connectionId), [connections]);
  const stageOf = useCallback((stageId: string): LiveStageRect | undefined => liveStages.find(value => value.id === stageId), [liveStages]);

  const clearPreview = useCallback((connectionId: string) => {
    setPreview(current => {
      if (current[connectionId] === undefined) return current;
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
  }, []);

  const commitPreview = useCallback((connectionId: string) => {
    const override = previewRef.current[connectionId];
    if (override === undefined) return;
    setPreview(current => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
    props.onConnectionEdit({
      connectionId,
      ...(override.source === undefined ? {} : { source: override.source }),
      ...(override.target === undefined ? {} : { target: override.target }),
      ...(override.segments === undefined ? {} : { segments: override.segments }),
    });
  }, [props.onConnectionEdit]);

  // The same route the diagram draws, including the clearance every connection
  // shares, so a dragged segment starts from exactly the line it shows.
  const routeOf = useCallback((connection: CanvasConnection, withOffsets: boolean) => connectionRouteFor(liveStages, connection, withOffsets), [liveStages]);

  const startAnchorDrag = useCallback((event: React.PointerEvent<SVGElement>, connectionId: string, end: ConnectionEnd) => {
    if (props.locked || event.button !== 0 || connectionDrag.current !== null) return;
    const connection = connectionOf(connectionId);
    if (connection === undefined) return;
    const stage = stageOf(end === 'source' ? connection.from : connection.to);
    if (stage === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rectOf(stage);
    let current = end === 'source' ? connection.source : connection.target;
    connectionDrag.current = beginConnectionDrag({
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      events: document as unknown as PointerEventsPort,
      keys: document as unknown as KeyboardEventsPort,
      onMove: pointer => {
        const flow = instance.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
        const next = nearestAnchor(rect, flow);
        if (sameAnchor(next, current)) return;
        current = next;
        setPreview(values => previewPatch(values, connectionId, end, next));
      },
      onCommit: () => { connectionDrag.current = null; commitPreview(connectionId); },
      onCancel: () => { connectionDrag.current = null; clearPreview(connectionId); },
    });
  }, [clearPreview, commitPreview, connectionOf, instance, props.locked, stageOf]);

  const startSegmentDrag = useCallback((event: React.PointerEvent<SVGElement>, connectionId: string, lineIndex: number) => {
    if (props.locked || event.button !== 0 || connectionDrag.current !== null) return;
    const connection = connectionOf(connectionId);
    if (connection === undefined) return;
    const route = routeOf(connection, false);
    const line = route?.lines.find(value => value.index === lineIndex);
    if (route === null || line === undefined) return;
    const order = route.lines.filter(value => value.axis === line.axis).findIndex(value => value.index === line.index);
    const base = connection.segments ?? [];
    event.preventDefault();
    event.stopPropagation();
    connectionDrag.current = beginConnectionDrag({
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      events: document as unknown as PointerEventsPort,
      keys: document as unknown as KeyboardEventsPort,
      onMove: pointer => {
        const flow = instance.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
        const coordinate = line.axis === 'x' ? flow.x : flow.y;
        const offset = Math.round(coordinate - line.coordinate);
        setPreview(values => {
          const current = values[connectionId] ?? {};
          return { ...values, [connectionId]: { ...current, segments: withOffset(base, line.axis, order, offset) } };
        });
      },
      onCommit: () => { connectionDrag.current = null; commitPreview(connectionId); },
      onCancel: () => { connectionDrag.current = null; clearPreview(connectionId); },
    });
  }, [clearPreview, commitPreview, connectionOf, instance, props.locked, routeOf]);

  const currentAnchor = useCallback((connectionId: string, end: ConnectionEnd): ConnectionAnchor | undefined => {
    const override = previewRef.current[connectionId];
    if (end === 'source') return override?.source ?? connectionOf(connectionId)?.source;
    return override?.target ?? connectionOf(connectionId)?.target;
  }, [connectionOf]);

  /** The anchor point nearest the automatic touch point, used when a keyboard step starts from an authored-free end. */
  const automaticAnchor = useCallback((connectionId: string, end: ConnectionEnd): ConnectionAnchor | undefined => {
    const connection = connectionOf(connectionId);
    if (connection === undefined) return undefined;
    const route = routeOf(connection, true);
    const stage = stageOf(end === 'source' ? connection.from : connection.to);
    if (route === null || stage === undefined) return undefined;
    const point: DiagramPoint | undefined = end === 'source' ? route.points[0] : route.points[route.points.length - 1];
    return point === undefined ? undefined : nearestAnchor(rectOf(stage), point);
  }, [connectionOf, routeOf, stageOf]);

  const anchorKeyDown = useCallback((event: React.KeyboardEvent<SVGElement>, connectionId: string, end: ConnectionEnd) => {
    if (props.locked) return;
    if (event.key === 'Enter') {
      if (previewRef.current[connectionId] === undefined) return;
      event.preventDefault();
      keyboardSession.current = null;
      commitPreview(connectionId);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      keyboardSession.current = null;
      clearPreview(connectionId);
      return;
    }
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const current = currentAnchor(connectionId, end) ?? automaticAnchor(connectionId, end);
    if (current === undefined) return;
    keyboardSession.current = { connectionId, end };
    const next = stepAnchor(current, forward ? 'next' : 'previous');
    setPreview(values => previewPatch(values, connectionId, end, next));
  }, [automaticAnchor, clearPreview, commitPreview, currentAnchor, props.locked]);

  const anchorBlur = useCallback((connectionId: string, end: ConnectionEnd) => {
    const session = keyboardSession.current;
    if (session === null || session.connectionId !== connectionId || session.end !== end) return;
    keyboardSession.current = null;
    clearPreview(connectionId);
  }, [clearPreview]);

  const describe = useCallback((connectionId: string, end: ConnectionEnd): string => {
    const connection = connectionOf(connectionId);
    const label = (stageId: string) => nodesRef.current.find(node => node.id === stageId)?.data.label ?? stageId;
    const anchor = currentAnchor(connectionId, end);
    const name = 'Arrow from ' + label(connection?.from ?? '') + ' to ' + label(connection?.to ?? '') + ', ' + (end === 'source' ? 'source' : 'target') + ' end';
    return anchor === undefined ? name : name + ' at ' + anchor.side + ' ' + anchor.at;
  }, [connectionOf, currentAnchor]);

  const handlers = useMemo<ConnectionHandlers>(() => ({
    locked: props.locked,
    onAnchorPointerDown: startAnchorDrag,
    onSegmentPointerDown: startSegmentDrag,
    onAnchorKeyDown: anchorKeyDown,
    onAnchorBlur: anchorBlur,
    describe,
  }), [anchorBlur, anchorKeyDown, describe, props.locked, startAnchorDrag, startSegmentDrag]);

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
    onStagePointerDown: startStageDrag,
    onStageResize: props.onStageResize,
    onStageResizeEnd: props.onStageResizeEnd,
    onStageResizeCancel: props.onStageResizeCancel,
  }), [props.callbacks, startStageDrag, props.onStageResize, props.onStageResizeEnd, props.onStageResizeCancel]);

  return <div ref={wrapper} className="kb-flow-canvas" data-ready={props.ready ? 'true' : 'false'} data-locked={props.locked ? 'true' : 'false'}>
    <style>{flowStyles}</style>
    <CardEnvironmentContext.Provider value={props.cardEnvironment}>
      <StageCallbacksContext.Provider value={callbacks}>
        <ConnectionHandlersContext.Provider value={handlers}>
          <StageDragContext.Provider value={{ stageId: props.dropStageId, indicatorY: props.dropIndicatorY }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              // React Flow assigns pointer events to a node only when it is interactive;
              // this no-op click keeps the stage content hittable without selecting it.
              onNodeClick={() => undefined}
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
            >
              {props.controls !== undefined && <Panel position="bottom-left">{props.controls(viewport)}</Panel>}
              <DiagramMinimap />
              {props.overlay !== undefined && <ViewportPortal>{props.overlay}</ViewportPortal>}
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
