import { describe, expect, it } from 'vitest';
import { scopedCommand } from '../../src/client/hub-view.js';

describe('Hub-aware command scoping', () => {
  it('targets the active board workflow when only the Hub count is plural', () => {
    expect(scopedCommand({ type: 'workflow.save', yaml: 'yaml', expectedRevision: 2 }, 'hub-b', 'board-b', true, false))
      .toEqual({ type: 'board.workflow.save', hubId: 'hub-b', boardId: 'board-b', yaml: 'yaml', expectedRevision: 2 });
  });

  it('targets the active board workflow when only the board count is plural', () => {
    expect(scopedCommand({ type: 'workflow.save', yaml: 'yaml' }, 'hub', 'board-b', false, true))
      .toEqual({ type: 'board.workflow.save', hubId: 'hub', boardId: 'board-b', yaml: 'yaml' });
  });

  it('keeps the legacy single-Hub single-board workflow command unchanged', () => {
    const command = { type: 'workflow.save' as const, yaml: 'yaml' };
    expect(scopedCommand(command, 'hub', 'board', false, false)).toBe(command);
  });

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
