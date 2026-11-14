import { describe, expect, it } from 'vitest';
import type { HubRelation, HubTask, TaskActivity } from '../../src/shared/types.js';
import { compactCard, detailCard, detailRelations, directChildren, plainCard } from '../../src/host/card-projection.js';
import { UNAVAILABLE_TASK_ACTIVITY } from '../../src/domain/task-activity.js';

const IDLE: TaskActivity = { available: true, running: false, pending: [], queuedPrompts: 0, backgroundCount: 0, settledTurns: [] };

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Card', description: 'Body text',
    columnId: 'backlog', position: 3, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo',
    worktree: null, operation: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as HubTask;
}

describe('card projections', () => {
  it('keeps the flow record and the ledger out of the plain card', () => {
    const projected = plainCard({ ...task(), history: [{ kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'backlog' }], deterministic: { entryId: 'e' } as never });
    expect('history' in projected).toBe(false);
    expect('deterministic' in projected).toBe(false);
  });

  it('omits the description from the compact card and keeps the context in the detail card', () => {
    const value = task();
    const compact = compactCard({ task: value, hubId: 'hub', relations: [], activity: IDLE });
    expect('description' in compact).toBe(false);
    expect(compact).toMatchObject({ id: 'task', boardId: 'board', columnId: 'backlog', position: 3, hubId: 'hub', activity: IDLE, relations: [] });
    const detail = detailCard({
      task: value, hubId: 'hub', hubName: 'Hub', project: { id: 'project', name: 'Project', projectKey: 'project', projectPath: '/repo' },
      board: { id: 'board', name: 'Board', workflowYaml: 'name: Flow', workflow: { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: '', updatedAt: '' },
      relations: [], activity: IDLE, relationDetails: [],
    });
    expect(detail).toMatchObject({ description: 'Body text', project: { id: 'project' }, board: { id: 'board', name: 'Board' }, hub: { id: 'hub', name: 'Hub' } });
    expect('epicRollup' in detail).toBe(false);
  });

  it('reports a relation reference with the other card resolved, and one relation per endpoint', () => {
    const relations: HubRelation[] = [{ id: 'r', type: 'epic', from: 'task', to: 'child' }];
    const hub = { id: 'hub', name: 'Hub', revision: 0, projects: [], boards: [], tasks: [task(), task({ id: 'child', title: 'Child', columnId: 'apply' })], notes: [], relations, createdAt: '', updatedAt: '' };
    expect(detailRelations(hub, relations, 'task')).toEqual([{ id: 'r', type: 'epic', direction: 'outgoing', otherTaskId: 'child', otherTitle: 'Child', otherColumnId: 'apply' }]);
    expect(detailRelations(hub, relations, 'child')[0]).toMatchObject({ direction: 'incoming', otherTaskId: 'task', otherTitle: 'Card' });
    expect(directChildren(hub, 'task').tasks.map(value => value.id)).toEqual(['child']);
    expect(directChildren(hub, 'child').total).toBe(0);
  });

  it('bounds the roll-up and reports the total with a truncation flag', () => {
    const children = Array.from({ length: 7 }, (_value, index) => task({ id: 'child-' + index, title: 'Child ' + index }));
    const relations: HubRelation[] = children.map(child => ({ id: 'r-' + child.id, type: 'epic' as const, from: 'task', to: child.id }));
    const hub = { id: 'hub', name: 'Hub', revision: 0, projects: [], boards: [], tasks: [task(), ...children], notes: [], relations, createdAt: '', updatedAt: '' };
    const bounded = directChildren(hub, 'task', 3);
    expect(bounded.tasks).toHaveLength(3);
    expect(bounded.total).toBe(7);
    expect(bounded.truncated).toBe(true);
  });

  it('leaves an unavailable activity untouched', () => {
    const compact = compactCard({ task: task(), hubId: 'hub', relations: [], activity: UNAVAILABLE_TASK_ACTIVITY });
    expect(compact.activity).toEqual(UNAVAILABLE_TASK_ACTIVITY);
  });
});
