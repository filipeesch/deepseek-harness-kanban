import { describe, expect, it } from 'vitest';
import { TASK_CONTEXT_NODE_KIND, taskContextDefinition } from '../../src/client/task-context-node.js';

function event(sourceKind = 'kanban-task', surfaceOp: 'append' | 'replace' = 'append') {
  return {
    type: 'user/message',
    seq: 5,
    time: 1_700_000_000_000,
    surfaceOp,
    data: {
      id: 'message-1',
      role: 'user',
      source: { kind: sourceKind },
      content: [{ type: 'text', text: 'Task: Alpha' }],
    },
  } as never;
}

function context(): Record<string, unknown> {
  const match = taskContextDefinition.match(event());
  if (match === null) throw new Error('expected a task-context match');
  const start = { ...match, event: event(), location: { kind: 'unresolved' as const } };
  const base: Record<string, unknown> = { key: 'context-key', kind: TASK_CONTEXT_NODE_KIND, id: 'message-1', matches: [start], start, current: new Map() };
  const state = taskContextDefinition.start(base as never, start as never, {} as never);
  return { ...base, state };
}

describe('task-context Chat node Definition', () => {
  it('claims only append-surface messages with the kanban-task source', () => {
    expect(taskContextDefinition.match(event())).toEqual({ id: 'message-1', role: 'start', exclusive: true });
    expect(taskContextDefinition.match(event('user'))).toBeNull();
    expect(taskContextDefinition.match(event('kanban-task', 'replace'))).toBeNull();
    expect(taskContextDefinition.match({ type: 'assistant/message', seq: 1, data: {} } as never)).toBeNull();
  });

  it('builds a visible turn-level node at the injected message position', () => {
    const node = taskContextDefinition.buildViewNode?.(context() as never) as unknown as Record<string, unknown>;
    expect(node).toMatchObject({
      key: 'context-key', kind: TASK_CONTEXT_NODE_KIND, id: 'message-1', target: 'chat',
      anchorSeq: 5, visibility: 'visible', groupTree: 'turn',
    });
    expect(node.data).toMatchObject({
      seq: 5,
      producer: { role: 'inject', label: 'kanban-task' },
      form: null,
      content: [{ type: 'text', text: 'Task: Alpha' }],
    });
  });

  it('publishes nothing without assembled state', () => {
    expect(taskContextDefinition.buildViewNode?.({ ...(context() as object), state: undefined } as never)).toBeNull();
  });
});
