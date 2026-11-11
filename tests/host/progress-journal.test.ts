import { describe, expect, it } from 'vitest';
import { OperationJournal, ProgressJournal } from '../../src/host/operation-journal.js';
import type { ContextOperation, HubState, Task } from '../../src/shared/types.js';

function operation(): ContextOperation {
  return {
    id: 'op', request: { kind: 'delete', discardChanges: false }, phase: 'switching',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '',
  };
}

function store() {
  const state = {
    id: 'hub', name: 'Hub', revision: 0, projects: [], boards: [], notes: [], createdAt: '', updatedAt: '',
    tasks: [{ id: 'task', operation: operation(), sessionIds: ['a', 'b'], closedSessionIds: [] } as unknown as Task],
  } as unknown as HubState;
  const writes: number[] = [];
  return {
    writes,
    state,
    async transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T> {
      writes.push(1);
      const result = change(state);
      return result;
    },
  };
}

describe('ProgressJournal', () => {
  it('writes nothing until the phase boundary and then writes the whole batch once', async () => {
    const s = store();
    const journal = new OperationJournal(s);
    const progress = new ProgressJournal(journal);
    progress.accumulate('task', 'op', (_task, current) => { current.previousDirectories.a = '/base'; });
    progress.accumulate('task', 'op', (_task, current) => { current.switchedSessionIds.push('a'); });
    expect(s.writes).toHaveLength(0);
    await progress.flush('task', 'op');
    expect(s.writes).toHaveLength(1);
    expect(s.state.tasks[0]!.operation!.previousDirectories).toEqual({ a: '/base' });
    expect(s.state.tasks[0]!.operation!.switchedSessionIds).toEqual(['a']);
  });

  it('drops a flushed batch instead of writing it twice', async () => {
    const s = store();
    const progress = new ProgressJournal(new OperationJournal(s));
    progress.accumulate('task', 'op', (_task, current) => { current.switchedSessionIds.push('a'); });
    await progress.flush('task', 'op');
    await progress.flush('task', 'op');
    expect(s.writes).toHaveLength(1);
    expect(s.state.tasks[0]!.operation!.switchedSessionIds).toEqual(['a']);
  });

  it('never fails the operation when the journal entry was replaced', async () => {
    const s = store();
    const progress = new ProgressJournal(new OperationJournal(s));
    progress.accumulate('task', 'replaced', (_task, current) => { current.switchedSessionIds.push('a'); });
    await expect(progress.flush('task', 'replaced')).resolves.toBeUndefined();
  });
});
