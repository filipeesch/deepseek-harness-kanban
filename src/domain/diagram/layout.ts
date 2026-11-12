import type { StagePosition, StageSize } from '../../shared/types.js';
import { STAGE_MIN_SIZE } from '../stage-size.js';

export type { StageSize };
export interface LayoutNode { readonly id: string; readonly index: number; readonly groupId?: string }
export interface LayoutConnection { readonly from: string; readonly to: string; readonly returning: boolean }
export interface PlacementBounds { readonly width: number; readonly height: number }
export interface StageLayout { readonly placements: ReadonlyMap<string, StagePosition>; readonly bounds: PlacementBounds }

export const DEFAULT_STAGE_SIZE: StageSize = STAGE_MIN_SIZE;
export const STAGE_COLUMN_GAP = 128;
export const STAGE_ROW_GAP = 36;

function layerOf(nodes: readonly LayoutNode[], connections: readonly LayoutConnection[]): Map<string, number> {
  const values = new Map(nodes.map(node => [node.id, 0]));
  const forward = connections.filter(connection => !connection.returning && values.has(connection.from) && values.has(connection.to));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const connection of forward) {
      const candidate = values.get(connection.from)! + 1;
      if (candidate > values.get(connection.to)!) { values.set(connection.to, candidate); changed = true; }
    }
    if (!changed) break;
  }
  return values;
}

/** Stages that share a group are ordered together, by the group's first member. */
function orderKey(node: LayoutNode, groupStart: ReadonlyMap<string, number>): number {
  if (node.groupId === undefined) return node.index * 2;
  return (groupStart.get(node.groupId) ?? node.index) * 2 - 1;
}

function groupStarts(nodes: readonly LayoutNode[]): Map<string, number> {
  const starts = new Map<string, number>();
  for (const node of nodes) {
    if (node.groupId === undefined) continue;
    const current = starts.get(node.groupId);
    if (current === undefined || node.index < current) starts.set(node.groupId, node.index);
  }
  return starts;
}

/**
 * Place stages in layers: one layer per longest forward path, layers ordered
 * left to right, stages ordered top to bottom by workflow order with grouped
 * stages kept together. Returning connections do not move a stage backwards.
 */
export function placeStages(input: {
  readonly nodes: readonly LayoutNode[];
  readonly connections: readonly LayoutConnection[];
  readonly sizes?: ReadonlyMap<string, StageSize>;
}): StageLayout {
  const sizes = input.sizes;
  const sizeOf = (id: string): StageSize => sizes?.get(id) ?? DEFAULT_STAGE_SIZE;
  const layers = layerOf(input.nodes, input.connections);
  const starts = groupStarts(input.nodes);
  const byLayer: LayoutNode[][] = [];
  for (const node of input.nodes) {
    const index = layers.get(node.id) ?? 0;
    (byLayer[index] ??= []).push(node);
  }
  const placements = new Map<string, StagePosition>();
  let x = 0;
  let boundsHeight = 0;
  for (let index = 0; index < byLayer.length; index++) {
    const layer = byLayer[index];
    if (layer === undefined) continue;
    layer.sort((left, right) => orderKey(left, starts) - orderKey(right, starts));
    let y = 0;
    let width = 0;
    for (const node of layer) {
      const size = sizeOf(node.id);
      placements.set(node.id, { x, y });
      y += size.height + STAGE_ROW_GAP;
      if (size.width > width) width = size.width;
    }
    boundsHeight = Math.max(boundsHeight, Math.max(0, y - STAGE_ROW_GAP));
    x += width + STAGE_COLUMN_GAP;
  }
  return { placements, bounds: { width: Math.max(0, x - STAGE_COLUMN_GAP), height: boundsHeight } };
}

/** The extent every placed stage occupies, used for fit-to-view. */
export function placementBounds(placements: ReadonlyMap<string, StagePosition>, sizes: ReadonlyMap<string, StageSize>): PlacementBounds {
  let width = 0;
  let height = 0;
  for (const [id, position] of placements) {
    const size = sizes.get(id) ?? DEFAULT_STAGE_SIZE;
    width = Math.max(width, position.x + size.width);
    height = Math.max(height, position.y + size.height);
  }
  return { width, height };
}
