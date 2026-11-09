import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Panel, ViewportPortal, applyNodeChanges,
  useReactFlow, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import flowStyles from '@xyflow/react/dist/style.css';
import { ConnectionEdgeView } from './connection-edge.js';
import { DiagramMinimap } from './controls/minimap.js';
import { StageCallbacksContext, StageDragContext, StageNodeView, type StageCallbacks, type StageNodeModel } from './stage-node.js';
import { CardEnvironmentContext, type CardEnvironment } from './card-environment.js';
import { beginStageDrag, type GestureHandle, type PointerEventsPort } from './gestures/stage-drag.js';
import { FLOW_ZOOM, nextZoom, zoomAroundPoint } from './gestures/viewport-policy.js';
import { liveConnections, type LiveConnectionDescriptor } from './live-connections.js';

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

export interface CanvasConnection extends LiveConnectionDescriptor {
  readonly from: string;
  readonly to: string;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
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
  /** The layout lock; a locked diagram never starts a stage move or resize. */
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
}

export type WorkflowCanvasComponent = React.ComponentType<WorkflowCanvasProps>;

type StageFlowNode = Node<StageNodeModel, 'stage'>;

const nodeTypes = { stage: StageNodeView } as unknown as NodeTypes;
const edgeTypes = { connection: ConnectionEdgeView } as unknown as EdgeTypes;

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

function CanvasInner(props: WorkflowCanvasProps) {
  const instance = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const drag = useRef<GestureHandle | null>(null);
  const [nodes, setNodes] = useState<StageFlowNode[]>(() => props.stages.map(stage => toNode(stage, props.locked)));

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

  useEffect(() => () => { drag.current?.dispose(); drag.current = null; }, []);

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

  const liveStages = useMemo(() => nodes.map(node => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.data.width,
    height: node.measured?.height ?? node.data.height,
  })), [nodes]);

  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(props.connections.map(connection => [connection.id, connection]));
    return liveConnections(liveStages, props.connections).flatMap(shape => {
      const connection = byId.get(shape.id);
      if (connection === undefined) return [];
      return [{
        id: shape.id,
        source: connection.from,
        target: connection.to,
        type: 'connection',
        data: { path: shape.path, points: shape.points, tipAngle: shape.tipAngle, kind: shape.kind, returning: shape.returning },
        selectable: false,
        focusable: false,
      }];
    });
  }, [liveStages, props.connections]);

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

  return <div ref={wrapper} className="kb-flow-canvas" data-ready={props.ready ? 'true' : 'false'}>
    <style>{flowStyles}</style>
    <CardEnvironmentContext.Provider value={props.cardEnvironment}>
      <StageCallbacksContext.Provider value={callbacks}>
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
      </StageCallbacksContext.Provider>
    </CardEnvironmentContext.Provider>
  </div>;
}

/** The React Flow surface: controlled stage nodes, drawn connections, pan and zoom. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
