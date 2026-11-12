import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import type { Rasterizer } from '../../src/host/rasterizer.js';
import type { WorkflowImage, WorkflowImagePort } from '../../src/host/workflow-image.js';
import { fixture } from './helpers.js';

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

function pngRasterizer(): Rasterizer {
  return { async render() { return { png: new Uint8Array([137, 80, 78, 71]) }; } };
}

function failingRasterizer(): Rasterizer {
  return { async render() { return { reason: 'No SVG rasterizer is installed; the drawing is available as an SVG file.' }; } };
}

function imagePort(): WorkflowImagePort {
  return { async attach(): Promise<WorkflowImage> { return { attachmentId: 'sha256:deadbeef', mediaType: 'image/png', bytes: 4, width: 320, height: 200, name: 'workflow.png' }; } };
}

async function setup(options: { rasterizer?: Rasterizer; images?: WorkflowImagePort } = {}): Promise<F> {
  const f = await fixture();
  const value: F = { ...f, tools: productToolDefinitions(f.app, f.app.boards, undefined, { ...(options.rasterizer === undefined ? {} : { rasterizer: options.rasterizer }), ...(options.images === undefined ? {} : { images: options.images }) }) };
  active.push(value);
  return value;
}

function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

function named(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

async function run(f: F, name: string, args: Record<string, unknown>): Promise<any> {
  return named(f.tools, name).execute(args, execution());
}

async function seedTask(f: F, history: unknown[]): Promise<string> {
  const task = await f.app.createTask({ projectId: f.project.id, title: 'Tracked', description: 'Do not leak this text' });
  await f.store.transact(draft => {
    const value = draft.tasks.find(candidate => candidate.id === task.id)!;
    value.columnId = 'done';
    value.history = history as never;
  });
  return task.id;
}

describe('route statistics tool', () => {
  it('reports the routes a board used over a window', async () => {
    const f = await setup();
    const taskId = await seedTask(f, [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'backlog' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'backlog', columnId: 'plan', origin: 'manual' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'plan', columnId: 'done', origin: 'agent' },
    ]);
    const value = await run(f, 'get_route_stats', { board_id: f.board.id, since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z' });
    expect(value.boardId).toBe(f.board.id);
    expect(value.transitions).toContainEqual(expect.objectContaining({ from: 'backlog', to: 'plan', count: 1 }));
    expect(value.transitions).toContainEqual(expect.objectContaining({ from: 'plan', to: 'done', count: 1 }));
    expect(value.stages.find((stage: { stage: string }) => stage.stage === 'plan')?.entries).toBe(1);
    expect(value.parked[0]).toMatchObject({ taskId, stage: 'done' });
    expect(value.unused.routes.length).toBeGreaterThan(0);
    expect(JSON.stringify(value)).not.toContain('Do not leak this text');
  });

  it('defaults the window to the last ninety days', async () => {
    const f = await setup();
    const value = await run(f, 'get_route_stats', { board_id: f.board.id });
    expect(Date.parse(value.window.until) - Date.parse(value.window.since)).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('filters by project', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Tracked', description: '' });
    await f.store.transact(draft => {
      const value = draft.tasks.find(candidate => candidate.id === task.id)!;
      value.history = [{ kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'backlog' }, { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'backlog', columnId: 'plan', origin: 'manual' }] as never;
    });
    const matching = await run(f, 'get_route_stats', { board_id: f.board.id, since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z', project_id: f.project.id });
    expect(matching.transitions).toHaveLength(1);
    const other = await run(f, 'get_route_stats', { board_id: f.board.id, since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z', project_id: 'missing' });
    expect(other.transitions).toEqual([]);
  });
});

describe('layout metrics tool', () => {
  it('measures the saved drawing', async () => {
    const f = await setup();
    const value = await run(f, 'layout_metrics', { board_id: f.board.id });
    expect(value.metrics).toMatchObject({ crossings: expect.any(Number), segmentsThroughStages: expect.any(Number), folds: expect.any(Number), totalLength: expect.any(Number) });
    expect(Array.isArray(value.metrics.problems)).toBe(true);
  });

  it('measures an unsaved proposal without saving it', async () => {
    const f = await setup();
    const before = (await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml;
    const proposed = before.replace('  - id: plan\n    label: Plan\n', '  - id: plan\n    label: Plan\n    position: {x: -400, y: -400}\n');
    const value = await run(f, 'layout_metrics', { board_id: f.board.id, yaml: proposed, cards: 'empty' });
    expect(value.metrics).toBeDefined();
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(before);
  });
});

describe('diagram rendering tool', () => {
  it('writes an SVG and a PNG and attaches the image when the route accepts it', async () => {
    const f = await setup({ rasterizer: pngRasterizer(), images: imagePort() });
    const value = await run(f, 'render_workflow_diagram', { board_id: f.board.id, cards: 'empty' });
    expect(value.svgPath).toMatch(/\.svg$/);
    expect(value.pngPath).toMatch(/\.png$/);
    expect(value.image).toMatchObject({ attachmentId: 'sha256:deadbeef', mediaType: 'image/png' });
    expect(await readFile(value.svgPath, 'utf8')).toContain('<svg');
    expect(value.metrics).toBeDefined();
  });

  it('reports the drawing and why there is no raster when no rasterizer exists', async () => {
    const f = await setup({ rasterizer: failingRasterizer() });
    const value = await run(f, 'render_workflow_diagram', { board_id: f.board.id });
    expect(value.svgPath).toMatch(/\.svg$/);
    expect(value.pngPath).toBeUndefined();
    expect(value.rasterReason).toContain('rasterizer');
    expect(value.image).toBeUndefined();
  });

  it('draws a given card count per stage', async () => {
    const f = await setup({ rasterizer: pngRasterizer() });
    const value = await run(f, 'render_workflow_diagram', { board_id: f.board.id, cards: { backlog: 4 }, zoom: 2 });
    expect(value.cards).toEqual({ backlog: 4 });
    expect(value.width).toBeGreaterThan(0);
  });

  it('draws a proposed document without saving it', async () => {
    const f = await setup({ rasterizer: pngRasterizer() });
    const before = (await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml;
    const proposed = before.replace('label: Plan', 'label: Planning');
    const value = await run(f, 'render_workflow_diagram', { board_id: f.board.id, yaml: proposed });
    expect(await readFile(value.svgPath, 'utf8')).toContain('Planning');
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(before);
  });
});
