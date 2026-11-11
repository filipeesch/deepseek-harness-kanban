import { createContext, useContext } from 'react';
import type { ConnectionAnchor } from '../../shared/types.js';

/** Which end of a connection a handle belongs to. */
export type ConnectionEnd = 'source' | 'target';

/**
 * What the edge view may ask of the surface that owns the connection gestures.
 * Shared through a context so node and edge data stay plain values.
 */
export interface ConnectionHandlers {
  /** True while the layout lock is on: the handles are drawn but cannot act. */
  readonly locked: boolean;
  /** The connection the diagram presents as selected. */
  readonly selectedId: string | null;
  /** Select one connection, or clear the selection. */
  onSelect(connectionId: string): void;
  /** Open the editor for one connection's condition, anchored at that connection. */
  onEditCondition(connectionId: string): void;
  onAnchorPointerDown(event: React.PointerEvent<SVGElement>, connectionId: string, end: ConnectionEnd): void;
  onSegmentPointerDown(event: React.PointerEvent<SVGElement>, connectionId: string, lineIndex: number): void;
  onAnchorKeyDown(event: React.KeyboardEvent<SVGElement>, connectionId: string, end: ConnectionEnd): void;
  onAnchorBlur(connectionId: string, end: ConnectionEnd): void;
  /** The accessible name of one connection end, including its current anchor. */
  describe(connectionId: string, end: ConnectionEnd): string;
}

export const ConnectionHandlersContext = createContext<ConnectionHandlers | null>(null);

export function useConnectionHandlers(): ConnectionHandlers | null {
  return useContext(ConnectionHandlersContext);
}

/** The twenty anchor points in the order a keyboard step walks them around a stage. */
export function perimeterAnchors(): ConnectionAnchor[] {
  const points: ConnectionAnchor[] = [];
  for (let at = 0; at < 5; at++) points.push({ side: 'top', at });
  for (let at = 0; at < 5; at++) points.push({ side: 'right', at });
  for (let at = 4; at >= 0; at--) points.push({ side: 'bottom', at });
  for (let at = 4; at >= 0; at--) points.push({ side: 'left', at });
  return points;
}

/** The anchor one keyboard step away from the current one, wrapping at the corners. */
export function stepAnchor(current: ConnectionAnchor, direction: 'next' | 'previous'): ConnectionAnchor {
  const points = perimeterAnchors();
  const index = points.findIndex(point => point.side === current.side && point.at === current.at);
  if (index < 0) return points[0]!;
  const step = direction === 'next' ? 1 : points.length - 1;
  return points[(index + step) % points.length]!;
}
