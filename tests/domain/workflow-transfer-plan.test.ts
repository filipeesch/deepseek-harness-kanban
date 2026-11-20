import { describe, expect, it } from 'vitest';
import type { Board, HubState } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { transferBoard } from '../../src/domain/workflow-transfer/document.js';
import { freeBoardName, sameBoardName, planTransfer, settleEntry, replacementOutcome } from '../../src/domain/workflow-transfer/plan.js';

const now = '2026-11-20T10:00:00.000Z';

function workflowOf(columns: Array<{ id: string; label?: string; key?: string }>): string {
  return ['name: Delivery', 'columns:', ...columns.flatMap(column => ['  - id: ' + column.id, '    label: ' + (column.label ?? column.id), ...(column.key === undefined ? [] : ['    key: ' + column.key])]), ''].join(String.fromCharCode(10));
}

function board(input: { id: string; name: string; columns: Array<{ id: string; label?: string; key?: string }>; localStageIdentities?: Record<string, string>; allowedProjectKeys?: string[]; defaultPresetMode?: 'operator' | 'host' }): Board {
  const yaml = workflowOf(input.columns);
  return {
    id: input.id, name: input.name, workflowYaml: yaml, workflow: parseWorkflow(yaml),
    ...(input.localStageIdentities === undefined ? {} : { localStageIdentities: input.localStageIdentities }),
    ...(input.allowedProjectKeys === undefined ? {} : { allowedProjectKeys: input.allowedProjectKeys }),
    ...(input.defaultPresetMode === undefined ? {} : { defaultPresetMode: input.defaultPresetMode }),
    createdAt: now, updatedAt: now,
  };
}

function hub(input: { boards: Board[]; tasks?: Array<{ boardId: string; columnId: string }>; projectKeys?: string[] }): HubState {
  return {
    id: 'hub-1', name: 'Team Hub', revision: 1,
    projects: (input.projectKeys ?? ['api']).map(key => ({ id: 'project-' + key, projectKey: key, name: key.toUpperCase(), projectPath: '/repo/' + key })),
    boards: input.boards,
    tasks: (input.tasks ?? []).map((task, index) => ({ ...task, id: 'task-' + String(index), projectId: 'project-api', title: 'Task ' + String(index), description: '', position: index, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/api', worktree: null, operation: null, createdAt: now, updatedAt: now })),
    notes: [], createdAt: now, updatedAt: now,
  };
}

const planned = (boards: Board[], entries: Parameters<typeof transferBoard>[0][], tasks: Array<{ boardId: string; columnId: string }> = [], projectKeys?: string[]) =>
  planTransfer({ hub: hub({ boards, tasks, ...(projectKeys === undefined ? {} : { projectKeys }) }), boards: entries.map(transferBoard), hubId: 'hub-1', origin: 'Home Hub' });

describe('free board name', () => {
  it('appends the imported suffix when it is free', () => {
    expect(freeBoardName('Delivery', ['Other'])).toBe('Delivery (imported)');
  });

  it('numbers past an existing suffixed name', () => {
    expect(freeBoardName('Delivery', ['Other', 'Delivery (imported)'])).toBe('Delivery (imported 2)');
    expect(freeBoardName('Delivery', ['Delivery (imported)', 'Delivery (imported 2)'])).toBe('Delivery (imported 3)');
  });

  it('compares case-insensitively, as the Hub does', () => {
    expect(freeBoardName('Delivery', ['delivery (IMPORTED)'])).toBe('Delivery (imported 2)');
  });

  it('compares two board names case-insensitively after trimming', () => {
    expect(sameBoardName(' Delivery ', 'delivery')).toBe(true);
    expect(sameBoardName('Delivery', 'Other')).toBe(false);
  });
});

describe('plan classification', () => {
  const delivery = board({ id: 'board-1', name: 'Delivery', columns: [{ id: 'todo' }, { id: 'done' }] });

  it('creates a board whose name is free', () => {
    const plan = planned([delivery], [{ name: 'Review', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    expect(plan.hubId).toBe('hub-1');
    expect(plan.origin).toBe('Home Hub');
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ name: 'Review', destination: 'create', targetBoardId: null, blockReason: null });
  });

  it('classifies a taken name as a conflict that names the existing board', () => {
    const plan = planned([delivery], [{ name: ' delivery ', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    expect(plan.entries[0]).toMatchObject({ destination: 'blocked', blockReason: 'name-conflict', targetBoardId: 'board-1' });
    expect(plan.entries[0]!.copyName).toBe('delivery (imported)');
  });

  it('blocks an entry whose workflow does not parse, with its reason', () => {
    const plan = planned([delivery], [{ name: 'Broken', workflowYaml: 'columns: []' }]);
    expect(plan.entries[0]).toMatchObject({ destination: 'blocked', blockReason: 'invalid-workflow' });
    expect(plan.entries[0]!.detail).toContain('at least one column');
  });

  it('blocks a conflicting entry whose workflow cannot be read instead of failing the plan', () => {
    const plan = planned([delivery], [{ name: 'Delivery', workflowYaml: 'columns: []' }]);
    expect(plan.entries[0]).toMatchObject({ destination: 'blocked', blockReason: 'invalid-workflow', targetBoardId: 'board-1' });
    expect(plan.entries[0]!.detail).toContain('at least one column');
  });

  it('gives two conflicts of the same name different copy proposals', () => {
    const plan = planned([delivery], [{ name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    expect(plan.entries[0]!.copyName).toBe('Delivery (imported)');
    const two = planned([delivery], [
      { name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ], [], ['api']);
    expect(two.entries[0]!.copyName).toBe('Delivery (imported)');
  });

  it('proposes a copy name that no later entry can reuse', () => {
    const plan = planned([delivery], [
      { name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo' }]) },
      { name: 'Delivery (imported)', workflowYaml: workflowOf([{ id: 'todo' }]) },
    ]);
    expect(plan.entries[1]).toMatchObject({ destination: 'create' });
  });
});

const renameFree = (): TransferWorkflow => [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }];
type TransferWorkflow = Array<{ id: string; label?: string; key?: string }>;

describe('replacement card placement', () => {
  const stored = board({ id: 'board-1', name: 'Delivery', columns: [{ id: 'todo', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }] });

  it('leaves a card alone when the incoming workflow keeps its stage', () => {
    const cards = new Map([['todo', 3]]);
    const outcome = replacementOutcome({ stored, incoming: workflowOf(renameFree()), cards });
    expect(outcome.stranded).toEqual([]);
    expect(outcome.realigned).toEqual([]);
  });

  it('realigns a card whose stage was renamed but kept its identity', () => {
    const cards = new Map([['todo', 2]]);
    const outcome = replacementOutcome({ stored, incoming: workflowOf([{ id: 'backlog', label: 'Backlog', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }]), cards });
    expect(outcome.stranded).toEqual([]);
    expect(outcome.realigned).toEqual([{ from: 'todo', to: 'backlog', cards: 2 }]);
  });

  it('strands a card whose stage identity no incoming stage carries', () => {
    const cards = new Map([['todo', 4]]);
    const outcome = replacementOutcome({ stored, incoming: workflowOf([{ id: 'done', key: 'identity-done' }]), cards });
    expect(outcome.stranded).toEqual([{ columnId: 'todo', stageIdentity: 'identity-todo', cards: 4 }]);
  });

  it('reads an identity from the local association when the stage authors none', () => {
    const associated = board({ id: 'board-2', name: 'Other', columns: [{ id: 'todo' }, { id: 'done' }], localStageIdentities: { todo: 'local-todo', done: 'local-done' } });
    const outcome = replacementOutcome({ stored: associated, incoming: workflowOf([{ id: 'renamed', key: 'local-todo' }, { id: 'done', key: 'local-done' }]), cards: new Map([['todo', 1]]) });
    expect(outcome.realigned).toEqual([{ from: 'todo', to: 'renamed', cards: 1 }]);
  });
});

describe('project scope filtering', () => {
  const delivery = board({ id: 'board-1', name: 'Delivery', columns: [{ id: 'todo' }] });

  it('keeps the keys the destination Hub holds', () => {
    const plan = planned([delivery], [{ name: 'Import', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['api'] }], [], ['api', 'web']);
    expect(plan.entries[0]!.droppedProjectKeys).toEqual([]);
    expect(plan.entries[0]!.scopeOpened).toBe(false);
  });

  it('drops an unknown key and reports it', () => {
    const plan = planned([delivery], [{ name: 'Import', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['api', 'gone'] }], [], ['api']);
    expect(plan.entries[0]!.droppedProjectKeys).toEqual(['gone']);
    expect(plan.entries[0]!.scopeOpened).toBe(false);
  });

  it('reports an emptied scope as opened', () => {
    const plan = planned([delivery], [{ name: 'Import', workflowYaml: workflowOf([{ id: 'todo' }]), projectKeys: ['gone', 'lost'] }], [], ['api']);
    expect(plan.entries[0]!.droppedProjectKeys).toEqual(['gone', 'lost']);
    expect(plan.entries[0]!.scopeOpened).toBe(true);
  });

  it('treats an entry with no scope as open without reporting a drop', () => {
    const plan = planned([delivery], [{ name: 'Import', workflowYaml: workflowOf([{ id: 'todo' }]) }], [], ['api']);
    expect(plan.entries[0]!.droppedProjectKeys).toEqual([]);
    expect(plan.entries[0]!.scopeOpened).toBe(false);
  });
});

describe('settling a conflict', () => {
  const stored = board({ id: 'board-1', name: 'Delivery', columns: [{ id: 'todo', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }] });

  it('settles Replace when nothing would be stranded', () => {
    const plan = planned([stored], [{ name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }]) }]);
    const settled = settleEntry({ entry: plan.entries[0]!, decision: { name: 'Delivery', settlement: 'replace' } });
    expect(settled.destination).toBe('replace');
    expect(settled.blockReason).toBeNull();
  });

  it('keeps the entry blocked when a card would be stranded, naming the stage', () => {
    const cards = board({ id: 'board-1', name: 'Delivery', columns: [{ id: 'todo', key: 'identity-todo' }, { id: 'done', key: 'identity-done' }] });
    const plan = planned([cards], [{ name: 'Delivery', workflowYaml: workflowOf([{ id: 'done', key: 'identity-done' }]) }], [{ boardId: 'board-1', columnId: 'todo' }]);
    expect(plan.entries[0]!.orphaned).toEqual([{ columnId: 'todo', stageIdentity: 'identity-todo', cards: 1 }]);
    const settled = settleEntry({ entry: plan.entries[0]!, decision: { name: 'Delivery', settlement: 'replace' } });
    expect(settled.destination).toBe('blocked');
    expect(settled.detail).toContain('todo');
    expect(settled.detail).toContain('1 card');
  });

  it('settles Skip without touching the board', () => {
    const plan = planned([stored], [{ name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    const settled = settleEntry({ entry: plan.entries[0]!, decision: { name: 'Delivery', settlement: 'skip' } });
    expect(settled.destination).toBe('skip');
    expect(settled.orphaned).toEqual([]);
  });

  it('settles a copy under the proposed name or an override', () => {
    const plan = planned([stored], [{ name: 'Delivery', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    expect(settleEntry({ entry: plan.entries[0]!, decision: { name: 'Delivery', settlement: 'copy' } }).copyName).toBe('Delivery (imported)');
    expect(settleEntry({ entry: plan.entries[0]!, decision: { name: 'Delivery', settlement: 'copy', copyName: 'Mine' } }).copyName).toBe('Mine');
  });

  it('leaves a free entry alone when a settlement names it', () => {
    const plan = planned([stored], [{ name: 'Free', workflowYaml: workflowOf([{ id: 'todo' }]) }]);
    expect(settleEntry({ entry: plan.entries[0]!, decision: { name: 'Free', settlement: 'skip' } }).destination).toBe('create');
  });
});
