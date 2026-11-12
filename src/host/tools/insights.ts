import type { ToolDefinition, ToolOutputDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KanbanApp } from '../app.js';
import type { Task } from '../../shared/types.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { routeStats, type RouteStatsCard } from '../../domain/route-stats.js';
import { diagramScene, renderWorkflowSvg, type CardMode } from '../../domain/diagram/render.js';
import { layoutMetrics } from '../../domain/diagram/metrics.js';
import { KanbanError } from '../../shared/errors.js';
import { json } from '../../shared/json.js';
import { normal, text } from './support.js';
import { resolveBoard, type ToolArgs } from './scope.js';
import { createRasterizer, type Rasterizer } from '../rasterizer.js';
import type { WorkflowImage, WorkflowImagePort } from '../workflow-image.js';

/** How far back statistics look when the caller names no window. */
const DEFAULT_WINDOW_DAYS = 90;

const cardsParameter = {
  oneOf: [
    { type: 'string', enum: ['current', 'empty'] },
    { type: 'object', additionalProperties: true },
  ],
  description: 'Which cards to draw: current shows the board\'s cards, empty shows none, and a mapping draws the given number of cards per stage id.',
} as const;

function cardMode(value: unknown): CardMode {
  if (value === undefined || value === 'current') return 'current';
  if (value === 'empty') return 'empty';
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([stage, count]) => [stage, typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0]));
  }
  throw new KanbanError('INVALID_INPUT', 'cards must be "current", "empty", or a mapping from stage id to a card count.');
}

interface RenderValue {
  readonly boardId: string;
  readonly cards: unknown;
  readonly width: number;
  readonly height: number;
  readonly svgPath: string;
  readonly pngPath?: string;
  readonly rasterReason?: string;
  readonly metrics: ReturnType<typeof layoutMetrics>;
  readonly image?: WorkflowImage;
}

/** The image block a result carries when the route can read it. */
const imageContent = ((_args: unknown, raw: unknown) => {
  const value = raw as RenderValue;
  return value.image === undefined
    ? [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    : [
      { type: 'text', text: 'Rendered the workflow diagram.\nSVG: ' + value.svgPath + (value.pngPath === undefined ? '' : '\nPNG: ' + value.pngPath) + '\nCrossings: ' + value.metrics.crossings + ', segments through stages: ' + value.metrics.segmentsThroughStages + ', folds: ' + value.metrics.folds + ', total route length: ' + value.metrics.totalLength + '\n' },
      { type: 'image', attachment: value.image },
    ];
}) as ToolOutputDefinition['render'];

/** The read-only measurement tools and the diagram drawing. */
export function insightsTools(app: KanbanApp, rasterizer: Rasterizer = createRasterizer(), images?: WorkflowImagePort): ToolDefinition[] {
  return [
    normal('get_route_stats', 'Report how one board workflow was used: each drawn transition with its uses by origin, each named script exit including the unused ones, each stage with its entries and time spent, the cards parked now and for how long, per-card loops, and the configured routes and exits no card used in the window. Reads aggregate identifiers, counts, and durations only; it never carries card text or conversation content. Reading changes nothing.', {
      board_id: text('Board ID.', true),
      since: text('Start of the window, as an ISO timestamp. Defaults to 90 days before until.'),
      until: text('End of the window, as an ISO timestamp. Defaults to now.'),
      project_id: text('Restrict the statistics to one project of the board Hub.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const { board, hub } = resolveBoard(app, args as ToolArgs, exec);
      const now = new Date();
      const until = args.until ?? now.toISOString();
      // The default start is measured from the window's own end, so a caller that
      // names only an end still gets the documented ninety days before it.
      const since = args.since ?? new Date(Date.parse(until) - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const cards: RouteStatsCard[] = hub.tasks.filter(task => task.boardId === board.id).map(task => ({
        taskId: task.id,
        projectId: task.projectId,
        columnId: task.columnId,
        ...(task.history === undefined ? {} : { history: task.history }),
      }));
      return { boardId: board.id, ...routeStats({ workflow: board.workflow, cards, options: { since, until, ...(args.project_id === undefined ? {} : { projectIds: [args.project_id] }) }, now: now.toISOString() }) };
    }, true),

    normal('layout_metrics', 'Measure one board workflow drawing: route crossings, segments that pass through a stage, segments that run over one another, overlapping stages, covered named-exit labels, folds, total route length, and a problem list naming the stages and connections involved. Accepts an unsaved workflow document to measure a proposal. Reading changes nothing.', {
      board_id: text('Board ID.', true),
      yaml: text('An unsaved workflow document to measure instead of the saved one.'),
      cards: cardsParameter,
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const { board, hub } = resolveBoard(app, args as ToolArgs, exec);
      const workflow = args.yaml === undefined ? board.workflow : parseWorkflow(args.yaml);
      const tasks = hub.tasks.filter(task => task.boardId === board.id) as unknown as Task[];
      const scene = diagramScene({ workflow, tasks, cards: cardMode(args.cards) });
      return { boardId: board.id, cards: args.cards ?? 'current', metrics: layoutMetrics({ workflow, scene }) };
    }, true),

    defineTool({
      name: 'render_workflow_diagram',
      description: 'Draw one board workflow as a diagram with the same connection routing, anchors, fan-out, and stage measurements the workflow view uses, and report where the drawing was written. Accepts an unsaved workflow document to preview a proposal, and a card mode to draw the current cards, none, or a given count per stage. The drawing is written as SVG always and as PNG when a rasterizer is installed; the image is attached only when the calling model accepts images. Drawing changes nothing.',
      parameters: {
        board_id: text('Board ID.', true),
        yaml: text('An unsaved workflow document to draw instead of the saved one.'),
        cards: cardsParameter,
        zoom: { type: 'number', description: 'Scale of the written drawing. Defaults to 1.' },
        hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      },
      output: { schema: { type: 'json' }, render: imageContent },
      isConcurrencySafe: () => true,
      async execute(args, exec: ToolRunContext) {
        const { board, hub } = resolveBoard(app, args as unknown as ToolArgs, exec);
        const workflow = args.yaml === undefined ? board.workflow : parseWorkflow(args.yaml);
        const tasks = hub.tasks.filter(task => task.boardId === board.id) as unknown as Task[];
        const diagram = renderWorkflowSvg({ workflow, tasks, cards: cardMode(args.cards), ...(args.zoom === undefined ? {} : { zoom: args.zoom }) });
        const directory = join(tmpdir(), 'dsh-kanban-workflow');
        await mkdir(directory, { recursive: true });
        const svgPath = join(directory, 'diagram-' + board.id + '.svg');
        await writeFile(svgPath, diagram.svg, { encoding: 'utf8', mode: 0o600 });
        const raster = await rasterizer.render(diagram.svg);
        let pngPath: string | undefined;
        if (raster.png !== undefined) {
          pngPath = join(directory, 'diagram-' + board.id + '.png');
          await writeFile(pngPath, raster.png, { mode: 0o600 });
        }
        const image = raster.png === undefined || images === undefined
          ? undefined
          : await images.attach({ png: raster.png, width: diagram.width, height: diagram.height, name: 'workflow-' + board.id + '.png' }, exec);
        return json({
          boardId: board.id,
          cards: args.cards ?? 'current',
          width: diagram.width,
          height: diagram.height,
          svgPath,
          ...(pngPath === undefined ? {} : { pngPath }),
          ...(raster.reason === undefined ? {} : { rasterReason: raster.reason }),
          metrics: layoutMetrics({ workflow, scene: diagram.scene }),
          ...(image === undefined ? {} : { image }),
        });
      },
    }),
  ];
}
