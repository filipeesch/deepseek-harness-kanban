import type { Column, StagePosition, StageSize, Task, Workflow } from '../../shared/types.js';
import { effectiveStageSize } from '../stage-size.js';
import { readStagePositions } from '../workflow-positions.js';
import { computeAutoLayout } from './auto-layout.js';
import type { DiagramPoint } from './orthogonal.js';
import { buildWorkflowScene, type WorkflowScene } from './scene.js';
import { estimateStageHeight, STAGE_HEADER_HEIGHT } from './stage-height.js';

/** Which cards a drawing shows. */
export type CardMode = 'current' | 'empty' | Readonly<Record<string, number>>;

/** How wide the drawing keeps around its stages. */
export const DIAGRAM_PADDING = 32;
/** The font size every label in the drawing uses. */
export const DIAGRAM_FONT_SIZE = 12;

/** One finished drawing, with the geometry it was drawn from. */
export interface WorkflowDiagram {
  readonly scene: WorkflowScene;
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

function countPerStage(mode: CardMode, workflow: Workflow, tasks: readonly Task[]): Record<string, number> {
  if (mode === 'empty') return Object.fromEntries(workflow.columns.map(column => [column.id, 0]));
  if (mode === 'current') {
    const counts: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const column of workflow.columns) counts[column.id] = 0;
    for (const task of tasks) if (counts[task.columnId] !== undefined) counts[task.columnId] = (counts[task.columnId] ?? 0) + 1;
    return counts;
  }
  // A stage id that matches an inherited object member (toString, constructor)
  // must read as no cards, not as a function of that name.
  return Object.fromEntries(workflow.columns.map(column => {
    const value = Object.hasOwn(mode, column.id) ? mode[column.id] : 0;
    return [column.id, typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0];
  }));
}

/** Placeholder cards, so a drawing of a count shows the same slots a real card does. */
function placeholders(workflow: Workflow, counts: Record<string, number>): Task[] {
  const tasks: Task[] = [];
  for (const column of workflow.columns) {
    for (let index = 0; index < (counts[column.id] ?? 0); index++) {
      tasks.push({ id: 'card-' + column.id + '-' + index, columnId: column.id } as unknown as Task);
    }
  }
  return tasks;
}

/**
 * The scene one drawing shows: the authored placements where a stage has one,
 * automatic placement everywhere else, and a stage height that grows with the
 * cards it is asked to show.
 */
export function diagramScene(input: { readonly workflow: Workflow; readonly tasks: readonly Task[]; readonly cards: CardMode }): WorkflowScene {
  const counts = countPerStage(input.cards, input.workflow, input.tasks);
  const sizes = new Map<string, StageSize>();
  for (const column of input.workflow.columns) {
    const authored = effectiveStageSize(column.size);
    sizes.set(column.id, { width: authored.width, height: estimateStageHeight(authored.height, counts[column.id] ?? 0) });
  }
  const authoredPositions: Record<string, StagePosition> = readStagePositions(input.workflow);
  const automatic = computeAutoLayout(input.workflow, sizes);
  const placements = new Map<string, StagePosition>(automatic.placements);
  for (const [id, position] of Object.entries(authoredPositions)) placements.set(id, position);
  const tasks = input.cards === 'current' ? input.tasks : placeholders(input.workflow, counts);
  return buildWorkflowScene({ workflow: input.workflow, tasks, placements, sizes });
}

/** The labels one connection draws: the named exits that route to its target. */
export function connectionLabels(workflow: Workflow): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const column of workflow.columns) {
    if (column.deterministic === undefined) continue;
    for (const [exit, destination] of Object.entries(column.deterministic.exits)) {
      const key = column.id + '\u0000' + destination;
      labels.set(key, [...(labels.get(key) ?? []), exit]);
    }
  }
  return labels;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The middle of a drawn path, where its label sits. */
export function pathMidpoint(points: readonly DiagramPoint[]): DiagramPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  const lengths: number[] = [];
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    lengths.push(length);
    total += length;
  }
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const length = lengths[index - 1]!;
    if (walked + length >= total / 2) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const ratio = length === 0 ? 0 : (total / 2 - walked) / length;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    walked += length;
  }
  return points[points.length - 1]!;
}

/** The box one label occupies in the drawing. */
export interface LabelBox { readonly edge: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly text: string }

/** Every label the drawing shows, in stage terms rather than pixels recovered from the text. */
export function labelBoxes(workflow: Workflow, scene: WorkflowScene): LabelBox[] {
  const labels = connectionLabels(workflow);
  const boxes: LabelBox[] = [];
  for (const edge of scene.edges) {
    const names = labels.get(edge.from + '\u0000' + edge.to);
    if (names === undefined || names.length === 0) continue;
    const text = names.join(', ');
    const middle = pathMidpoint(edge.shape.points);
    const width = text.length * DIAGRAM_FONT_SIZE * 0.58 + 14;
    const height = DIAGRAM_FONT_SIZE * 1.25 + 8;
    boxes.push({ edge: edge.id, x: middle.x - width / 2, y: middle.y - 8 - height, width, height, text });
  }
  return boxes;
}

/**
 * Draw one workflow as a standalone SVG with the same geometry the diagram view
 * uses. A named-exit label renders beside its connection, a stage renders its
 * header and one slot per card, and nothing here measures the browser: stage
 * heights are the documented estimate.
 */
export function renderWorkflowSvg(input: { readonly workflow: Workflow; readonly tasks: readonly Task[]; readonly cards: CardMode; readonly zoom?: number }): WorkflowDiagram {
  const scene = diagramScene(input);
  const boxes = labelBoxes(input.workflow, scene);
  // Authored placements may be negative, so the drawing is offset from the
  // content's own top-left corner instead of from the origin.
  const rects = [
    ...scene.nodes.map(node => ({ x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height })),
    ...boxes.map(box => ({ x: box.x, y: box.y, width: box.width, height: box.height })),
    // Returning routes and displaced segments may travel below or above the stages.
    ...scene.edges.flatMap(edge => edge.shape.points.map(point => ({ x: point.x, y: point.y, width: 0, height: 0 }))),
  ];
  const minX = Math.min(0, ...rects.map(rect => rect.x));
  const minY = Math.min(0, ...rects.map(rect => rect.y));
  const contentWidth = Math.max(1, Math.max(scene.bounds.width, ...rects.map(rect => rect.x + rect.width)) - minX);
  const contentHeight = Math.max(1, Math.max(scene.bounds.height, ...rects.map(rect => rect.y + rect.height)) - minY);
  const scale = Number.isFinite(input.zoom) && input.zoom! > 0 ? input.zoom! : 1;
  const width = Math.max(1, Math.ceil((contentWidth + DIAGRAM_PADDING * 2) * scale));
  const height = Math.max(1, Math.ceil((contentHeight + DIAGRAM_PADDING * 2) * scale));
  const viewWidth = Math.ceil(contentWidth + DIAGRAM_PADDING * 2);
  const viewHeight = Math.ceil(contentHeight + DIAGRAM_PADDING * 2);
  const offsetX = DIAGRAM_PADDING - minX;
  const offsetY = DIAGRAM_PADDING - minY;
  const parts: string[] = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + viewWidth + ' ' + viewHeight + '" font-family="system-ui, -apple-system, Segoe UI, sans-serif">');
  parts.push('<rect width="100%" height="100%" fill="#f7f7f8"/>');
  parts.push('<g transform="translate(' + offsetX + ',' + offsetY + ')">');
  for (const edge of scene.edges) {
    parts.push('<path d="' + edge.shape.path + '" fill="none" stroke="#b9b9c2" stroke-width="1.6"' + (edge.kind === 'implicit' ? ' stroke-dasharray="6 5"' : '') + '/>');
    const tip = edge.shape.points[edge.shape.points.length - 1];
    if (tip !== undefined) parts.push('<polygon points="0,0 -10,-4.5 -10,4.5" transform="translate(' + tip.x + ',' + tip.y + ') rotate(' + (Number.isFinite(edge.shape.tipAngle) ? edge.shape.tipAngle : 0) + ')" fill="#8b8b96"/>');
  }
  for (const node of scene.nodes) {
    const cards = node.tasks.length;
    parts.push('<g>');
    parts.push('<rect x="' + node.position.x + '" y="' + node.position.y + '" width="' + node.size.width + '" height="' + node.size.height + '" rx="14" fill="#ffffff" stroke="#d7d7de"/>');
    parts.push('<line x1="' + node.position.x + '" y1="' + (node.position.y + STAGE_HEADER_HEIGHT) + '" x2="' + (node.position.x + node.size.width) + '" y2="' + (node.position.y + STAGE_HEADER_HEIGHT) + '" stroke="#e6e6ec"/>');
    parts.push('<text x="' + (node.position.x + 12) + '" y="' + (node.position.y + 27) + '" font-size="13" font-weight="650" fill="#26262e">' + escapeText(node.name) + '</text>');
    parts.push('<text x="' + (node.position.x + node.size.width - 12) + '" y="' + (node.position.y + 27) + '" font-size="11" text-anchor="end" fill="#7a7a86">' + cards + '</text>');
    if (cards === 0) parts.push('<text x="' + (node.position.x + 12) + '" y="' + (node.position.y + STAGE_HEADER_HEIGHT + 22) + '" font-size="11" fill="#9a9aa6">No cards</text>');
    for (let index = 0; index < cards; index++) {
      const top = node.position.y + STAGE_HEADER_HEIGHT + 8 + index * (estimateCardSlot(node.size.height, cards));
      parts.push('<rect x="' + (node.position.x + 8) + '" y="' + top + '" width="' + (node.size.width - 16) + '" height="' + (estimateCardSlot(node.size.height, cards) - 8) + '" rx="8" fill="#fbfbfd" stroke="#e4e4ea"/>');
    }
    parts.push('</g>');
  }
  for (const box of boxes) {
    parts.push('<rect x="' + box.x + '" y="' + box.y + '" width="' + box.width + '" height="' + box.height + '" rx="4" fill="#ffffff" stroke="#d7d7de"/>');
    parts.push('<text x="' + (box.x + 7) + '" y="' + (box.y + box.height - 6) + '" font-size="' + DIAGRAM_FONT_SIZE + '" font-weight="600" fill="#3a3a44">' + escapeText(box.text) + '</text>');
  }
  parts.push('</g></svg>');
  return { scene, svg: parts.join(''), width, height };
}

/** The height one card slot occupies inside a drawn stage. */
function estimateCardSlot(stageHeight: number, cards: number): number {
  if (cards <= 0) return 0;
  const available = Math.max(0, stageHeight - STAGE_HEADER_HEIGHT - 16);
  return Math.max(24, available / cards);
}