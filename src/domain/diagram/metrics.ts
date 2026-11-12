import type { Workflow } from '../../shared/types.js';
import type { DiagramPoint, DiagramRect } from './orthogonal.js';
import { labelBoxes } from './render.js';
import type { WorkflowScene, WorkflowSceneEdge, WorkflowSceneNode } from './scene.js';

/** One reason a drawing reads badly, naming what is involved. */
export interface MetricsProblem {
  readonly kind: 'segments-cross' | 'segment-through-stage' | 'segments-overlap' | 'stages-overlap' | 'label-covered' | 'label-overlap';
  readonly stages?: readonly string[];
  readonly connections?: readonly string[];
}

/** How one drawing's geometry reads. */
export interface LayoutMetrics {
  /** Route segments of different connections that cross. */
  readonly crossings: number;
  /** Route segments that pass through a stage they do not connect. */
  readonly segmentsThroughStages: number;
  /** Route segments of different connections that run over one another. */
  readonly overlappingSegments: number;
  readonly overlappingStages: number;
  /** Named-exit labels a stage or another label covers. */
  readonly coveredLabels: number;
  /** Direction changes along the routes. */
  readonly folds: number;
  readonly totalLength: number;
  readonly problems: readonly MetricsProblem[];
}

interface Segment { readonly from: DiagramPoint; readonly to: DiagramPoint; readonly edge: string }

const EPSILON = 0.01;

function rectOf(node: WorkflowSceneNode): DiagramRect {
  return { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height };
}

function segments(edge: WorkflowSceneEdge): Segment[] {
  const result: Segment[] = [];
  for (let index = 1; index < edge.shape.points.length; index++) {
    const from = edge.shape.points[index - 1]!;
    const to = edge.shape.points[index]!;
    if (Math.abs(from.x - to.x) < EPSILON && Math.abs(from.y - to.y) < EPSILON) continue;
    result.push({ from, to, edge: edge.id });
  }
  return result;
}

function horizontal(segment: Segment): boolean {
  return Math.abs(segment.from.y - segment.to.y) < EPSILON;
}

function overlaps(first: { low: number; high: number }, second: { low: number; high: number }): boolean {
  return Math.min(first.high, second.high) - Math.max(first.low, second.low) > EPSILON;
}

function span(segment: Segment, axis: 'x' | 'y'): { low: number; high: number } {
  const a = axis === 'x' ? segment.from.x : segment.from.y;
  const b = axis === 'x' ? segment.to.x : segment.to.y;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/** Whether two segments cross: opposite axes with each body inside the other's span. */
function crosses(first: Segment, second: Segment): boolean {
  if (horizontal(first) === horizontal(second)) return false;
  const horizontalSegment = horizontal(first) ? first : second;
  const verticalSegment = horizontal(first) ? second : first;
  const y = horizontalSegment.from.y;
  const x = verticalSegment.from.x;
  const within = (value: number, range: { low: number; high: number }) => value > range.low + EPSILON && value < range.high - EPSILON;
  return within(x, span(horizontalSegment, 'x')) && within(y, span(verticalSegment, 'y'));
}

/** Whether the segment passes through the interior of the rectangle. */
function throughStage(segment: Segment, rect: DiagramRect): boolean {
  const horizontalSpan = { low: rect.x, high: rect.x + rect.width };
  const verticalSpan = { low: rect.y, high: rect.y + rect.height };
  if (horizontal(segment)) {
    const y = segment.from.y;
    return y > verticalSpan.low + EPSILON && y < verticalSpan.high - EPSILON && overlaps(span(segment, 'x'), horizontalSpan);
  }
  const x = segment.from.x;
  return x > horizontalSpan.low + EPSILON && x < horizontalSpan.high - EPSILON && overlaps(span(segment, 'y'), verticalSpan);
}

/** Whether two segments of different connections run over one another. */
function collinearOverlap(first: Segment, second: Segment): boolean {
  if (horizontal(first) !== horizontal(second)) return false;
  const axis = horizontal(first) ? 'x' : 'y';
  const lineAxis = horizontal(first) ? 'y' : 'x';
  const firstLine = axis === 'x' ? first.from.y : first.from.x;
  const secondLine = axis === 'x' ? second.from.y : second.from.x;
  if (Math.abs(firstLine - secondLine) > EPSILON) return false;
  void lineAxis;
  return overlaps(span(first, axis), span(second, axis));
}

function rectsOverlap(first: DiagramRect, second: DiagramRect): boolean {
  return first.x < second.x + second.width - EPSILON && second.x < first.x + first.width - EPSILON
    && first.y < second.y + second.height - EPSILON && second.y < first.y + first.height - EPSILON;
}

function boxOverlapsRect(box: { x: number; y: number; width: number; height: number }, rect: DiagramRect): boolean {
  return rectsOverlap({ x: box.x, y: box.y, width: box.width, height: box.height }, rect);
}

/** How many direction changes one connection's route makes. */
function folds(edge: WorkflowSceneEdge): number {
  const parts = segments(edge);
  let count = 0;
  for (let index = 1; index < parts.length; index++) {
    if (horizontal(parts[index - 1]!) !== horizontal(parts[index]!)) count += 1;
  }
  return count;
}

/**
 * Measure one drawing: crossings, segments that pass through a stage, segments
 * that run over one another, overlapping stages, covered exit labels, folds, and
 * the total route length. The metrics describe the same geometry the drawing
 * shows for the same input, including the estimated stage heights.
 */
export function layoutMetrics(input: { readonly workflow: Workflow; readonly scene: WorkflowScene }): LayoutMetrics {
  const all = input.scene.edges.flatMap(segments);
  const problems: MetricsProblem[] = [];
  let crossings = 0;
  let segmentsThroughStages = 0;
  let overlappingSegments = 0;
  for (let index = 0; index < all.length; index++) {
    for (let other = index + 1; other < all.length; other++) {
      const first = all[index]!;
      const second = all[other]!;
      if (first.edge === second.edge) continue;
      if (crosses(first, second)) {
        crossings += 1;
        problems.push({ kind: 'segments-cross', connections: [first.edge, second.edge] });
      }
      if (collinearOverlap(first, second)) {
        overlappingSegments += 1;
        problems.push({ kind: 'segments-overlap', connections: [first.edge, second.edge] });
      }
    }
  }
  for (const segment of all) {
    const edge = input.scene.edges.find(value => value.id === segment.edge);
    if (edge === undefined) continue;
    for (const node of input.scene.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      if (!throughStage(segment, rectOf(node))) continue;
      segmentsThroughStages += 1;
      problems.push({ kind: 'segment-through-stage', stages: [node.id], connections: [edge.id] });
    }
  }
  let overlappingStages = 0;
  for (let index = 0; index < input.scene.nodes.length; index++) {
    for (let other = index + 1; other < input.scene.nodes.length; other++) {
      const first = input.scene.nodes[index]!;
      const second = input.scene.nodes[other]!;
      if (!rectsOverlap(rectOf(first), rectOf(second))) continue;
      overlappingStages += 1;
      problems.push({ kind: 'stages-overlap', stages: [first.id, second.id] });
    }
  }
  const boxes = labelBoxes(input.workflow, input.scene);
  // One covered label counts once, whatever covers it or how many times it is covered.
  const covered = new Set<string>();
  for (const box of boxes) {
    const coveredBy = input.scene.nodes.find(node => boxOverlapsRect(box, rectOf(node)));
    if (coveredBy !== undefined) covered.add(box.edge);
    const overlapped = boxes.filter(other => other.edge !== box.edge && rectsOverlap(
      { x: box.x, y: box.y, width: box.width, height: box.height },
      { x: other.x, y: other.y, width: other.width, height: other.height },
    ));
    if (coveredBy !== undefined) problems.push({ kind: 'label-covered', stages: [coveredBy.id], connections: [box.edge] });
    if (overlapped.length > 0) {
      covered.add(box.edge);
      problems.push({ kind: 'label-overlap', connections: [box.edge, ...overlapped.map(other => other.edge)] });
    }
  }
  const coveredLabels = covered.size;
  return {
    crossings,
    segmentsThroughStages,
    overlappingSegments,
    overlappingStages,
    coveredLabels,
    folds: input.scene.edges.reduce((sum, edge) => sum + folds(edge), 0),
    totalLength: Math.round(all.reduce((sum, segment) => sum + Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y), 0)),
    problems,
  };
}