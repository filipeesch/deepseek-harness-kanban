import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { cardRowKeys, columnLayout, planColumns } from '../../src/client/board-columns.js';
import { task } from './helpers.js';

const workflow: Workflow = {
  name: 'Delivery', initialColumnId: 'todo',
  columns: [{ id: 'todo', name: 'Todo' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done' }],
  groups: [{ id: 'active', name: 'Active', columnIds: ['todo', 'doing'] }],
};
const tasks = [
  task('t1', 'First', 'p', 'todo'),
  task('t2', 'Second', 'p', 'todo'),
  task('t3', 'Third', 'p', 'doing'),
  task('t4', 'Fourth', 'p', 'done'),
];

function keys(plan: ReturnType<typeof planColumns>): string[] { return cardRowKeys(plan); }

describe('column layout', () => {
  it('keeps a group together and does not render a claimed column twice', () => {
    const layout = columnLayout(workflow);
    expect(layout.map(slot => slot.key)).toEqual(['group-active', 'column-done']);
    expect(layout[0]!.columns.map(column => column.id)).toEqual(['todo', 'doing']);
    expect(layout[0]!.group?.name).toBe('Active');
  });

  it('renders the columns owned by the workflow in their declared order', () => {
    const plan = planColumns(workflow, tasks, null);
    expect(plan.flatMap(slot => slot.columns.map(column => column.column.id))).toEqual(['todo', 'doing', 'done']);
  });
});

describe('column planning', () => {
  it('places every task in its stage in the order the caller supplied', () => {
    expect(keys(planColumns(workflow, tasks, null))).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('renders only the tasks the caller kept', () => {
    expect(keys(planColumns(workflow, [tasks[1]!, tasks[3]!], null))).toEqual(['t2', 't4']);
  });

  it('inserts an optimistic move at the top of its destination', () => {
    const plan = planColumns(workflow, tasks, { taskId: 't4', columnId: 'todo', placement: 'start' });
    expect(keys(plan)).toEqual(['t4', 't1', 't2', 't3']);
  });

  it('inserts an optimistic move after the last card', () => {
    const plan = planColumns(workflow, tasks, { taskId: 't4', columnId: 'doing', placement: 'end' });
    expect(keys(plan)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('inserts an optimistic move before its anchor', () => {
    const plan = planColumns(workflow, tasks, { taskId: 't4', columnId: 'todo', placement: { before: 't2' } });
    expect(keys(plan)).toEqual(['t1', 't4', 't2', 't3']);
  });

  it('falls back to the end when the optimistic anchor is gone', () => {
    const plan = planColumns(workflow, tasks, { taskId: 't1', columnId: 'doing', placement: { before: 'missing' } });
    expect(keys(plan)).toEqual(['t2', 't3', 't1', 't4']);
  });

  it('ignores an optimistic move for a task the caller did not render', () => {
    expect(keys(planColumns(workflow, tasks, { taskId: 'gone', columnId: 'todo', placement: 'start' }))).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('keeps an empty destination column rendered without tasks', () => {
    const plan = planColumns(workflow, [tasks[0]!], null);
    expect(plan.flatMap(slot => slot.columns.flatMap(column => [column.column.id, column.tasks.length]))).toEqual(['todo', 1, 'doing', 0, 'done', 0]);
  });
});
