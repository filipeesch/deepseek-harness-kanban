import { describe, expect, it } from 'vitest';
import { scopedCommand } from '../../src/client/hub-view.js';

describe('Hub-aware command scoping', () => {
  it('scopes task creation with the Hub when multiple Hubs exist', () => {
    expect(scopedCommand({ type: 'task.create', projectId: 'p', title: 'T', description: '' }, 'hub-b', 'board-b', true, false))
      .toMatchObject({ type: 'task.create', hubId: 'hub-b' });
    expect(scopedCommand({ type: 'task.create', projectId: 'p', title: 'T', description: '' }, 'hub-b', 'board-b', true, true))
      .toMatchObject({ type: 'task.create', hubId: 'hub-b', boardId: 'board-b' });
  });

  it('keeps the task-scoped instruction unchanged when multiple Hubs exist', () => {
    const command = { type: 'task.runInstruction' as const, taskId: 't1', columnId: 'review', expectedEnteredAt: 42, expectedInstruction: 'Review **carefully**.' };
    expect(scopedCommand(command, 'hub-b', 'board-b', true, true)).toBe(command);
  });
});
