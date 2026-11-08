import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Panel, ViewportPortal, applyNodeChanges,
  useReactFlow, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeChange, type NodeProps, type NodeTypes,
} from '@xyflow/react';
import flowStyles from '@xyflow/react/dist/style.css';
import { ConnectionEdgeView } from './connection-edge.js';
import { StageCallbacksContext, StageDragContext, StageNodeView, type FlowCard, type StageCallbacks, type StageNodeModel } from './stage-node.js';
import type { DiagramPoint } from './connections.js';

export interface CanvasStage {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly cards: readonly FlowCard[];
}

export interface CanvasConnection {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
}

export interface WorkflowCanvasProps {
  readonly stages: readonly CanvasStage[];
  readonly connections: readonly CanvasConnection[];
  /** False until every stage has been measured, so the first paint never jumps. */
  readonly ready: boolean;
  /** Increment to frame the whole diagram. */
  readonly fitRequest: number;
  readonly callbacks: StageCallbacks;
  /** The stage and insertion line under an active card drag. */
  readonly dropStageId: string | null;
  readonly dropIndicatorY: number | null;
  readonly overlay?: React.ReactNode;
  readonly onStageMove: (stageId: string, position: { x: number; y: number }) => void;
}

export type WorkflowCanvasComponent = React.ComponentType<WorkflowCanvasProps>;

type StageFlowNode = Node<StageNodeModel, 'stage'>;

const nodeTypes = { stage: StageNodeView } as unknown as NodeTypes;
const edgeTypes = { connection: ConnectionEdgeView } as unknown as EdgeTypes;

function toNode(stage: CanvasStage): StageFlowNode {
  return {
    id: stage.id,
    type: 'stage',
    position: { x: stage.x, y: stage.y },
    data: { id: stage.id, label: stage.label, cards: stage.cards },
    draggable: false,
    selectable: false,
  };
}

function CanvasInner(props: WorkflowCanvasProps) {
  const instance = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [nodes, setNodes] = useState<StageFlowNode[]>(() => props.stages.map(toNode));
  const signature = useMemo(() => JSON.stringify(props.stages.map(stage => [
    stage.id, stage.x, stage.y, stage.label,
    stage.cards.map(card => [card.id, card.title, card.projectName, card.running, card.unread, card.failed]),
  ])), [props.stages]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const draggingStage = useRef(false);
  const stageDrag = useRef<{ cleanup: () => void } | null>(null);

  useEffect(() => {
    if (draggingStage.current) return;
    setNodes(props.stages.map(toNode));
  }, [signature]);

  const onNodesChange = useCallback((changes: NodeChange<StageFlowNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
  }, []);

  // The header drag is ours, not React Flow's: a stage must move on its own
  // header while a card drag on the same node area stays a card gesture.
  const startStageDrag = useCallback((event: React.PointerEvent<HTMLElement>, stageId: string) => {
    if (event.button !== 0 || stageDrag.current !== null) return;
    const stage = nodesRef.current.find(node => node.id === stageId);
    if (stage === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: stage.position.x, y: stage.position.y };
    let active = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (stageDrag.current?.cleanup === cleanup) stageDrag.current = null;
    };
    const finish = (commit: boolean) => {
      cleanup();
      // A click or a cancelled gesture never authors a position.
      if (!commit || !active) return;
      const settled = nodesRef.current.find(node => node.id === stageId);
      if (settled !== undefined) props.onStageMove(stageId, settled.position);
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!active) {
        if (Math.hypot(dx, dy) < 3) return;
        active = true;
      }
      const zoom = instance.getZoom();
      setNodes(current => current.map(candidate => candidate.id === stageId ? { ...candidate, position: { x: origin.x + dx / zoom, y: origin.y + dy / zoom } } : candidate));
    };
    const up = (upEvent: PointerEvent) => { if (upEvent.pointerId === pointerId) finish(true); };
    const cancel = (cancelEvent: PointerEvent) => { if (cancelEvent.pointerId === pointerId) finish(false); };
    stageDrag.current = { cleanup: () => finish(false) };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }, [instance, props.onStageMove]);

  useEffect(() => () => { stageDrag.current?.cleanup(); }, []);

  useEffect(() => {
    if (!props.ready) return;
    const frame = requestAnimationFrame(() => { void instance.fitView({ padding: 0.2, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [props.ready, props.fitRequest, instance]);

  // React Flow treats ctrl+wheel (a trackpad pinch) as zoom, but not cmd+wheel.
  // The capture listener runs before its own wheel handling and zooms at the pointer.
  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const flow = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const factor = Math.exp(-event.deltaY * 0.002);
      const zoom = Math.min(2.5, Math.max(0.2, instance.getZoom() * factor));
      void instance.setViewport({ x: event.clientX - rect.left - flow.x * zoom, y: event.clientY - rect.top - flow.y * zoom, zoom }, { duration: 0 });
    };
    element.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => element.removeEventListener('wheel', onWheel, { capture: true });
  }, [instance]);

  const edges: Edge[] = props.connections.map(connection => ({
    id: connection.id,
    source: connection.from,
    target: connection.to,
    type: 'connection',
    data: { path: connection.path, points: connection.points, kind: connection.kind, returning: connection.returning },
    selectable: false,
    focusable: false,
  }));

  return <div ref={wrapper} className="kb-flow-canvas" data-ready={props.ready ? 'true' : 'false'}>
    <style>{flowStyles}</style>
    <StageCallbacksContext.Provider value={{ ...props.callbacks, onStagePointerDown: startStageDrag }}>
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
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.2}
        maxZoom={2.5}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      >
        <Panel position="top-right" className="kb-flow-zoom">
          <button type="button" className="kb-button kb-icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => { void instance.zoomIn({ duration: 120 }); }}>+</button>
          <button type="button" className="kb-button kb-icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => { void instance.zoomOut({ duration: 120 }); }}>−</button>
          <button type="button" className="kb-button" aria-label="Fit to view" title="Fit to view" onClick={() => { void instance.fitView({ padding: 0.2, duration: 120 }); }}>Fit</button>
        </Panel>
        {props.overlay !== undefined && <ViewportPortal>{props.overlay}</ViewportPortal>}
      </ReactFlow>
      </StageDragContext.Provider>
    </StageCallbacksContext.Provider>
  </div>;
}

/** The React Flow surface: controlled stage nodes, drawn connections, pan and zoom. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
