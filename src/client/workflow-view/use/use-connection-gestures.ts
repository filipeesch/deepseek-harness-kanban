import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionAnchor, StageSide } from '../../../shared/types.js';
import { sameAnchor, sameConnectionLayout } from '../../../domain/connection-anchor.js';
import { beginConnectionDrag, type KeyboardEventsPort } from '../gestures/connection-drag.js';
import { noSnap, segmentOffset, type SnapPolicy } from '../gestures/grid-snap.js';
import type { GestureHandle, PointerEventsPort } from '../gestures/stage-drag.js';
import type { ConnectionShape, DiagramPoint } from '../../../domain/diagram/orthogonal.js';
import { anchorPoint, nearestAnchor } from '../../../domain/diagram/ports.js';
import { creationCandidateFor, creationPreviewRoute } from '../creation-preview.js';
import { authoredOffsetAt, baselineCoordinateOf, connectionLayoutOf, connectionRouteFor, withOffset, type ConnectionLayoutOverride, type LiveStageRect } from '../edge-model.js';
import { candidateStageFor, decideEndDrop } from '../connection-target.js';
import { stepAnchor, type ConnectionEnd, type ConnectionHandlers } from '../connection-interaction.js';
import { editable, type ConnectionMode } from '../connection-mode.js';
import type { CanvasConnection, ConnectionEdit } from '../canvas-types.js';

/** The connection layout a gesture previews before it is committed. */
type ConnectionPreview = ConnectionLayoutOverride;

/** The line a creation drag presents, and the route it would author over a candidate. */
export interface CreationState {
  readonly from: DiagramPoint;
  readonly to: DiagramPoint;
  /** The route the release would author; absent while the pointer is over no stage. */
  readonly route?: ConnectionShape;
}

function rectOf(stage: LiveStageRect) {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

function previewPatch(values: Record<string, ConnectionPreview>, connectionId: string, end: ConnectionEnd, anchor: ConnectionAnchor): Record<string, ConnectionPreview> {
  const current = values[connectionId] ?? {};
  return { ...values, [connectionId]: end === 'source' ? { ...current, source: anchor } : { ...current, target: anchor } };
}

export interface ConnectionGestureInput {
  readonly mode: ConnectionMode;
  readonly snap: SnapPolicy;
  /** The connections the view presents, already merged with its own overrides. */
  readonly connections: readonly CanvasConnection[];
  readonly stages: readonly LiveStageRect[];
  readonly stageLabel: (stageId: string) => string;
  /** A client coordinate in diagram space. */
  readonly flowPoint: (client: { readonly clientX: number; readonly clientY: number }) => DiagramPoint;
  /** The stage under a client coordinate, through the diagram's own hit test. */
  readonly resolveStage: (client: { readonly clientX: number; readonly clientY: number }) => string | null;
  readonly onConnectionEdit: (edit: ConnectionEdit) => void;
  /** Select one connection, used when a press on a mark never moves. */
  readonly onSelect: (connectionId: string) => void;
  readonly onCreate: (sourceId: string, to: string, side: StageSide) => void;
  readonly onRepoint: (sourceId: string, from: string, to: string) => void;
  readonly onReown: (fromSource: string, to: string, toSource: string) => void;
}

export interface ConnectionGestures {
  /** The connection as this gesture should draw it, with its preview applied. */
  present(connection: CanvasConnection): CanvasConnection;
  readonly handlers: Omit<ConnectionHandlers, 'selectedId' | 'onSelect' | 'onEditCondition' | 'hoveredId' | 'onHover' | 'onHoverEnd'>;
  /** Start drawing a new connection from one side of one stage. */
  beginCreation(event: React.PointerEvent<Element>, stageId: string, side: StageSide): void;
  /** The stage a connection gesture would act on. */
  readonly candidateStageId: string | null;
  /** The line being drawn, from its source stage to the pointer. */
  readonly creation: CreationState | null;
}

/**
 * Every pointer gesture a connection supports: moving an end's anchor, moving a
 * route segment, re-drawing a connection onto another stage, and drawing a new one.
 * The surface keeps the React Flow instance, the stage drag, and the viewport; this
 * controller owns the connection gestures and the preview they present.
 */
export function useConnectionGestures(input: ConnectionGestureInput): ConnectionGestures {
  const inputRef = useRef(input); inputRef.current = input;
  const [preview, setPreview] = useState<Record<string, ConnectionPreview>>({});
  const previewRef = useRef(preview); previewRef.current = preview;
  const [creation, setCreation] = useState<CreationState | null>(null);
  const [candidateStageId, setCandidateStageId] = useState<string | null>(null);
  const drag = useRef<GestureHandle | null>(null);
  const keyboardSession = useRef<{ connectionId: string; end: ConnectionEnd } | null>(null);

  // A gesture listens on the document, so it must not outlive the surface that started
  // it: leaving the diagram mid-drag would otherwise let a later pointerup write.
  useEffect(() => () => { drag.current?.dispose(); drag.current = null; }, []);

  const connectionOf = useCallback((connectionId: string) => inputRef.current.connections.find(value => value.id === connectionId), []);
  const stageOf = useCallback((stageId: string) => inputRef.current.stages.find(value => value.id === stageId), []);

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
    // The baseline is the presented connection without this gesture's preview, so an
    // adjustment that settles on the layout it already has is not a layout edit.
    const baseline = inputRef.current.connections.find(value => value.id === connectionId);
    if (baseline === undefined || sameConnectionLayout(connectionLayoutOf(baseline, override), connectionLayoutOf(baseline, {}))) return;
    inputRef.current.onConnectionEdit({
      connectionId,
      ...(override.source === undefined ? {} : { source: override.source }),
      ...(override.target === undefined ? {} : { target: override.target }),
      ...(override.segments === undefined ? {} : { segments: override.segments }),
    });
  }, []);

  /** The route the diagram draws, including the clearance its own corridor needs. */
  const routeOf = useCallback((connection: CanvasConnection, withOffsets: boolean) => connectionRouteFor(inputRef.current.stages, connection, withOffsets), []);

  const currentAnchor = useCallback((connectionId: string, end: ConnectionEnd): ConnectionAnchor | undefined => {
    const override = previewRef.current[connectionId];
    if (end === 'source') return override?.source ?? connectionOf(connectionId)?.source;
    return override?.target ?? connectionOf(connectionId)?.target;
  }, [connectionOf]);

  /** The anchor nearest the automatic touch point, used when a keyboard step starts from a free end. */
  const automaticAnchor = useCallback((connectionId: string, end: ConnectionEnd): ConnectionAnchor | undefined => {
    const connection = connectionOf(connectionId);
    if (connection === undefined) return undefined;
    const route = routeOf(connection, true);
    const stage = stageOf(end === 'source' ? connection.from : connection.to);
    if (route === null || stage === undefined) return undefined;
    const point: DiagramPoint | undefined = end === 'source' ? route.points[0] : route.points[route.points.length - 1];
    return point === undefined ? undefined : nearestAnchor(rectOf(stage), point);
  }, [connectionOf, routeOf, stageOf]);

  /** The stage a release of one end would re-point or re-own, or null when it would change nothing. */
  const candidateUnder = useCallback((end: ConnectionEnd, connection: CanvasConnection, position: { readonly clientX: number; readonly clientY: number }): string | null => {
    return candidateStageFor({ end, from: connection.from, to: connection.to, stageUnder: inputRef.current.resolveStage(position) });
  }, []);

  const startAnchorDrag = useCallback((event: React.PointerEvent<Element>, connectionId: string, end: ConnectionEnd) => {
    const current = inputRef.current;
    if (!editable(current.mode) || event.button !== 0 || drag.current !== null) return;
    const connection = connectionOf(connectionId);
    if (connection === undefined) return;
    const stage = stageOf(end === 'source' ? connection.from : connection.to);
    if (stage === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rectOf(stage);
    let anchor = end === 'source' ? connection.source : connection.target;
    let pointer: { clientX: number; clientY: number } = { clientX: event.clientX, clientY: event.clientY };
    drag.current = beginConnectionDrag({
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey },
      events: document as unknown as PointerEventsPort,
      keys: document as unknown as KeyboardEventsPort,
      onMove: position => {
        pointer = position;
        setCandidateStageId(candidateUnder(end, connection, position));
        const next = nearestAnchor(rect, current.flowPoint(position));
        if (sameAnchor(next, anchor)) return;
        anchor = next;
        setPreview(values => previewPatch(values, connectionId, end, next));
      },
      onCommit: () => {
        drag.current = null;
        setCandidateStageId(null);
        // A release over another stage changes the destination instead of the anchor;
        // the layout preview belongs to the gesture that did not happen.
        const decision = decideEndDrop({ end, from: connection.from, to: connection.to, stageUnder: current.resolveStage(pointer) });
        if (decision.kind === 'repoint') { clearPreview(connectionId); current.onRepoint(connection.from, connection.to, decision.to); return; }
        if (decision.kind === 'reown') { clearPreview(connectionId); current.onReown(connection.from, connection.to, decision.toSource); return; }
        if (decision.kind === 'none') { clearPreview(connectionId); return; }
        commitPreview(connectionId);
      },
      onPress: () => {
        drag.current = null;
        setCandidateStageId(null);
        clearPreview(connectionId);
        current.onSelect(connectionId);
      },
      onCancel: () => {
        drag.current = null;
        setCandidateStageId(null);
        clearPreview(connectionId);
      },
    });
  }, [candidateUnder, clearPreview, commitPreview, connectionOf, stageOf]);

  const startSegmentDrag = useCallback((event: React.PointerEvent<Element>, connectionId: string, lineIndex: number) => {
    const current = inputRef.current;
    if (!editable(current.mode) || event.button !== 0 || drag.current !== null) return;
    const connection = connectionOf(connectionId);
    if (connection === undefined) return;
    // The drawn route, not one rebuilt without offsets: a displacement on the other
    // axis can move the corridor and the floor, and the drag must start from where
    // the line really is.
    const route = routeOf(connection, true);
    const line = route?.lines.find(value => value.index === lineIndex);
    if (route === null || line === undefined) return;
    const order = route.lines.filter(value => value.axis === line.axis).findIndex(value => value.index === line.index);
    const base = connection.segments ?? [];
    let free = event.altKey === true;
    // The displacement the authored layout already applies to this line: a gesture
    // that returns the segment to it changes nothing.
    const authored = authoredOffsetAt(base, line.axis, order);
    const baseline = baselineCoordinateOf(route, line.axis, order, base);
    if (baseline === undefined) return;
    let changed = false;
    event.preventDefault();
    event.stopPropagation();
    drag.current = beginConnectionDrag({
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      events: document as unknown as PointerEventsPort,
      keys: document as unknown as KeyboardEventsPort,
      onSample: pointer => { if (pointer.altKey === true) free = true; },
      onMove: pointer => {
        const flow = current.flowPoint(pointer);
        const coordinate = line.axis === 'x' ? flow.x : flow.y;
        const offset = segmentOffset(free ? noSnap : current.snap, coordinate, baseline);
        changed = offset !== authored;
        setPreview(values => {
          const previous = values[connectionId] ?? {};
          return { ...values, [connectionId]: { ...previous, segments: withOffset(base, line.axis, order, offset) } };
        });
      },
      onCommit: () => {
        drag.current = null;
        if (changed) commitPreview(connectionId); else clearPreview(connectionId);
      },
      onPress: () => {
        drag.current = null;
        clearPreview(connectionId);
        current.onSelect(connectionId);
      },
      onCancel: () => {
        drag.current = null;
        clearPreview(connectionId);
      },
    });
  }, [clearPreview, commitPreview, connectionOf, routeOf]);

  const beginCreation = useCallback((event: React.PointerEvent<Element>, stageId: string, side: StageSide) => {
    const current = inputRef.current;
    if (!editable(current.mode) || event.button !== 0 || drag.current !== null) return;
    const stage = stageOf(stageId);
    if (stage === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    // The line starts at the middle of the side the user grabbed, so the gesture shows
    // exactly the departure the connection will be drawn with.
    const from = anchorPoint(rectOf(stage), { side, at: 2 }).point;
    let pointer: { clientX: number; clientY: number } = { clientX: event.clientX, clientY: event.clientY };
    setCreation({ from, to: from });
    setCandidateStageId(null);
    drag.current = beginConnectionDrag({
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      events: document as unknown as PointerEventsPort,
      keys: document as unknown as KeyboardEventsPort,
      onMove: position => {
        pointer = position;
        const to = current.flowPoint(position);
        const candidate = creationCandidateFor({ sourceId: stageId, stageUnder: current.resolveStage(position), connections: current.connections });
        setCandidateStageId(candidate);
        // Over a candidate the gesture presents the route the release would author,
        // so the user sees the arrow instead of only the pointer line.
        const route = candidate === null ? null : creationPreviewRoute({
          stages: current.stages, connections: current.connections, sourceId: stageId, targetId: candidate, side,
        });
        setCreation(route === null ? { from, to } : { from, to, route });
      },
      onCommit: () => {
        drag.current = null;
        setCreation(null);
        setCandidateStageId(null);
        const target = creationCandidateFor({ sourceId: stageId, stageUnder: current.resolveStage(pointer), connections: current.connections });
        if (target !== null) current.onCreate(stageId, target, side);
      },
      onCancel: () => {
        drag.current = null;
        setCreation(null);
        setCandidateStageId(null);
      },
    });
  }, [stageOf]);

  const anchorKeyDown = useCallback((event: React.KeyboardEvent<Element>, connectionId: string, end: ConnectionEnd) => {
    if (!editable(inputRef.current.mode)) return;
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
  }, [automaticAnchor, clearPreview, commitPreview, currentAnchor]);

  const anchorBlur = useCallback((connectionId: string, end: ConnectionEnd) => {
    const session = keyboardSession.current;
    if (session === null || session.connectionId !== connectionId || session.end !== end) return;
    keyboardSession.current = null;
    clearPreview(connectionId);
  }, [clearPreview]);

  const describe = useCallback((connectionId: string, end: ConnectionEnd): string => {
    const connection = connectionOf(connectionId);
    const label = (stageId: string) => inputRef.current.stageLabel(stageId);
    const anchor = currentAnchor(connectionId, end);
    const condition = connection?.condition === undefined ? ' without a condition' : ' with a condition';
    const name = 'Arrow from ' + label(connection?.from ?? '') + ' to ' + label(connection?.to ?? '') + ', ' + (end === 'source' ? 'source' : 'target') + ' end' + condition;
    return anchor === undefined ? name : name + ' at ' + anchor.side + ' ' + anchor.at;
  }, [connectionOf, currentAnchor]);

  const handlers = useMemo<Omit<ConnectionHandlers, 'selectedId' | 'onSelect' | 'onEditCondition' | 'hoveredId' | 'onHover' | 'onHoverEnd'>>(() => ({
    mode: input.mode,
    onAnchorPointerDown: startAnchorDrag,
    onSegmentPointerDown: startSegmentDrag,
    onAnchorKeyDown: anchorKeyDown,
    onAnchorBlur: anchorBlur,
    describe,
  }), [anchorBlur, anchorKeyDown, describe, input.mode, startAnchorDrag, startSegmentDrag]);

  const present = useCallback((connection: CanvasConnection): CanvasConnection => {
    const override = preview[connection.id];
    if (override === undefined) return connection;
    return {
      ...connection,
      ...(override.source === undefined ? {} : { source: override.source }),
      ...(override.target === undefined ? {} : { target: override.target }),
      ...(override.segments === undefined ? {} : { segments: override.segments }),
    };
  }, [preview]);

  return { present, handlers, beginCreation, candidateStageId, creation };
}
