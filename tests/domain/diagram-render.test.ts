import { describe, expect, it } from 'vitest';
import { diagramScene, renderWorkflowSvg } from '../../src/domain/diagram/render.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { STAGE_MIN_SIZE } from '../../src/domain/stage-size.js';
import type { Task } from '../../src/shared/types.js';

const FLOW = 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [wait]\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: project\n      exits: {passed: done}\n  - id: done\n    label: Done\n';

function task(id: string, columnId: string): Task {
  return { id, columnId } as unknown as Task;
}

describe('workflow diagram rendering', () => {
  it('draws one stage per node and one path per connection', () => {
    const workflow = parseWorkflow(FLOW);
    const diagram = renderWorkflowSvg({ workflow, tasks: [], cards: 'empty' });
    expect(diagram.svg.startsWith('<svg')).toBe(true);
    expect(Array.from(diagram.svg.matchAll(/rx="14"/g))).toHaveLength(3);
    expect(Array.from(diagram.svg.matchAll(/<path /g))).toHaveLength(2);
    expect(diagram.svg).toContain('Todo');
    expect(diagram.svg).toContain('Done');
  });

  it('draws the named exit of a script connection', () => {
    const diagram = renderWorkflowSvg({ workflow: parseWorkflow(FLOW), tasks: [], cards: 'empty' });
    expect(diagram.svg).toContain('passed');
  });

  it('grows a stage with the cards it is asked to show', () => {
    const workflow = parseWorkflow(FLOW);
    const empty = diagramScene({ workflow, tasks: [], cards: 'empty' });
    const five = diagramScene({ workflow, tasks: [task('a', 'todo'), task('b', 'todo'), task('c', 'todo'), task('d', 'todo'), task('e', 'todo')], cards: 'current' });
    const emptyTodo = empty.nodes.find(node => node.id === 'todo')!;
    const fiveTodo = five.nodes.find(node => node.id === 'todo')!;
    expect(emptyTodo.size.height).toBe(STAGE_MIN_SIZE.height);
    expect(fiveTodo.size.height).toBeGreaterThan(emptyTodo.size.height);
    expect(fiveTodo.tasks).toHaveLength(5);
  });

  it('draws a given count per stage', () => {
    const scene = diagramScene({ workflow: parseWorkflow(FLOW), tasks: [], cards: { todo: 3, done: 0 } });
    expect(scene.nodes.find(node => node.id === 'todo')?.tasks).toHaveLength(3);
    expect(scene.nodes.find(node => node.id === 'done')?.tasks).toHaveLength(0);
  });

  it('draws the current cards of the board', () => {
    const scene = diagramScene({ workflow: parseWorkflow(FLOW), tasks: [task('a', 'done')], cards: 'current' });
    expect(scene.nodes.find(node => node.id === 'done')?.tasks).toHaveLength(1);
  });

  it('scales the written drawing without changing its content', () => {
    const workflow = parseWorkflow(FLOW);
    const plain = renderWorkflowSvg({ workflow, tasks: [], cards: 'empty' });
    const zoomed = renderWorkflowSvg({ workflow, tasks: [], cards: 'empty', zoom: 2 });
    expect(zoomed.width).toBe(plain.width * 2);
    expect(zoomed.svg).toContain('viewBox="0 0 ' + Math.ceil(plain.width / 1) + ' ');
    expect(zoomed.svg).toContain('<path ');
  });

  it('fits a negative authored placement inside the drawing', () => {
    const positioned = FLOW.replace('    label: Todo', '    label: Todo\n    position: {x: -100, y: -50}');
    const diagram = renderWorkflowSvg({ workflow: parseWorkflow(positioned), tasks: [], cards: 'empty' });
    // The group is offset by the content's own top-left corner, so the padding
    // stays visible on every side instead of clipping the stage.
    expect(diagram.svg).toContain('translate(132,82)');
    expect(diagram.width).toBeGreaterThan(0);
  });

  it('keeps the authored placement and adds automatic placement elsewhere', () => {
    const positioned = FLOW.replace('    label: Todo', '    label: Todo\n    position: {x: 40, y: 60}');
    const scene = diagramScene({ workflow: parseWorkflow(positioned), tasks: [], cards: 'empty' });
    expect(scene.nodes.find(node => node.id === 'todo')?.position).toEqual({ x: 40, y: 60 });
    expect(scene.nodes.find(node => node.id === 'done')?.position).not.toEqual({ x: 0, y: 0 });
  });
});