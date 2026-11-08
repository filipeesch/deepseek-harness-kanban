import { describe, expect, it } from 'vitest';
import { buildUpdatePlan, compareSharing, type SharingInput } from '../../src/domain/sharing/plan.js';
import type { SharedHubDocument } from '../../src/domain/sharing/document.js';
import type { LocalSharedBoard } from '../../src/domain/sharing/projection.js';

const nl = String.fromCharCode(10);
type Stage = readonly [id: string, label: string, position?: readonly [number, number]];

function flow(name: string, stages: readonly Stage[]): string {
  const lines = ['name: ' + name, 'columns:'];
  for (const [id, label, position] of stages) {
    lines.push('  - id: ' + id);
    lines.push('    label: ' + label);
    if (position !== undefined) lines.push('    position: {x: ' + position[0] + ', y: ' + position[1] + '}');
  }
  lines.push('');
  return lines.join(nl);
}

function documentOf(workflow: string, name = 'Delivery'): SharedHubDocument {
  return { version: 1, boards: [{ key: 'key-1', name, workflow }] };
}

function localBoard(workflow: string, options: { name?: string; taskColumns?: Array<{ columnId: string; tasks: number }> } = {}): LocalSharedBoard {
  const taskColumns = options.taskColumns ?? [];
  return {
    boardId: 'board-1',
    name: options.name ?? 'Delivery',
    workflow,
    key: 'key-1',
    tasks: taskColumns.reduce((total, entry) => total + entry.tasks, 0),
    taskColumns,
  };
}

function inputOf(versions: { base: string; local: string; published: string; localName?: string; taskColumns?: Array<{ columnId: string; tasks: number }> }): SharingInput {
  return {
    base: documentOf(versions.base),
    published: documentOf(versions.published),
    local: [localBoard(versions.local, { ...(versions.localName === undefined ? {} : { name: versions.localName }), ...(versions.taskColumns === undefined ? {} : { taskColumns: versions.taskColumns }) })],
    bindings: { 'board-1': 'key-1' },
    orphans: {},
    removed: {},
    pendingRemovals: [],
  };
}

const baseStages: readonly Stage[] = [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']];
const base = flow('Delivery', baseStages);

describe('sharing plan with stage placement', () => {
  it('applies a placement-only difference without a choice', () => {
    const local = flow('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = flow('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [260, 0]], ['done', 'Done']]);
    const input = inputOf({ base, local, published });
    const comparison = compareSharing(input);
    expect(comparison.boards[0]?.decision).toBe('updates-available');
    expect(comparison.conflicts).toBe(0);
    const plan = buildUpdatePlan(input);
    const applied = plan.apply[0]!;
    expect(applied.workflow).toContain('position: {x: 50, y: 0}');
    expect(applied.workflow).toContain('position: {x: 260, y: 0}');
    expect(plan.nextBase.boards[0]?.workflow).toBe(published);
  });

  it('keeps the local placement beside a published meaning change', () => {
    const local = flow('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [320, 0]], ['done', 'Done']]);
    const published = flow('Delivery', [['todo', 'To do', [15, 0]], ['doing', 'Active', [200, 0]], ['done', 'Done']]);
    const plan = buildUpdatePlan(inputOf({ base, local, published }));
    const applied = plan.apply[0]!;
    expect(applied.workflow).toContain('label: Active');
    expect(applied.workflow).toContain('position: {x: 320, y: 0}');
    expect(applied.workflow).toContain('position: {x: 15, y: 0}');
  });

  it('keeps a local draft when the published board did not change', () => {
    const local = flow('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const comparison = compareSharing(inputOf({ base, local, published: base }));
    expect(comparison.boards[0]?.decision).toBe('draft');
    expect(comparison.drafts).toBe(1);
  });

  it('still requires a choice for two different meaning changes', () => {
    const local = flow('Delivery', [['todo', 'Todo'], ['doing', 'Doing'], ['done', 'Done']]);
    const published = flow('Delivery', [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Finished']]);
    const input = inputOf({ base, local, published });
    const comparison = compareSharing(input);
    expect(comparison.boards[0]?.decision).toBe('needs-review');
    expect(comparison.conflicts).toBe(1);
    const plan = buildUpdatePlan(input);
    expect(plan.apply).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
  });

  it('keeps a local rename while merging a published placement move', () => {
    const published = flow('Delivery', [['todo', 'To do', [5, 5]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const plan = buildUpdatePlan(inputOf({ base, local: base, published, localName: 'Local delivery' }));
    expect(plan.apply[0]?.name).toBe('Local delivery');
    expect(plan.apply[0]?.workflow).toContain('position: {x: 5, y: 5}');
  });

  it('judges the name conflict on the resolved name, not the published one', () => {
    const base = flow('Original', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const local = flow('Original', [['todo', 'To do', [40, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = flow('Original', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [260, 0]], ['done', 'Done']]);
    const input: SharingInput = {
      base: { version: 1, boards: [{ key: 'key-1', name: 'Original', workflow: base }] },
      published: { version: 1, boards: [{ key: 'key-1', name: 'Original', workflow: published }] },
      local: [
        localBoard(local, { name: 'Renamed' }),
        { boardId: 'board-2', name: 'Original', workflow: base, tasks: 0, taskColumns: [] },
      ],
      bindings: { 'board-1': 'key-1' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    };
    const comparison = compareSharing(input);
    expect(comparison.blockers).toEqual([]);
    expect(comparison.boards.find(board => board.boardId === 'board-1')?.decision).toBe('updates-available');
  });

  it('refuses the application when the merged workflow orphans a task column', () => {
    const local = flow('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = flow('Delivery', [['todo', 'To do'], ['doing', 'Doing']]);
    const comparison = compareSharing(inputOf({ base, local, published, taskColumns: [{ columnId: 'done', tasks: 1 }] }));
    expect(comparison.blockers[0]).toMatchObject({ code: 'SHARING_ORPHAN_COLUMNS', columnId: 'done', tasks: 1 });
  });
});
