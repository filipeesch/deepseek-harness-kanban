import { describe, expect, it } from 'vitest';
import { TASK_MESSAGE_NODE_KIND, taskMessageDefinition } from '../../src/client/task-message-node.js';

function event(sourceKind = 'task-message', surfaceOp: 'append' | 'replace' = 'append') {
  return {
    type: 'user/message',
    seq: 7,
    time: 1_700_000_000_000,
    surfaceOp,
    data: {
      id: 'message-7',
      role: 'user',
      source: { kind: sourceKind, form: 'notice', summary: 'Task message from Sender' },
      content: [{ type: 'text', text: 'Message from task "Sender" (sender).' }],
    },
  } as never;
}

function context(): Record<string, unknown> {
  const match = taskMessageDefinition.match(event());
  if (match === null) throw new Error('expected a task-message match');
  const start = { ...match, event: event(), location: { kind: 'unresolved' as const } };
  const base: Record<string, unknown> = { key: 'context-key', kind: TASK_MESSAGE_NODE_KIND, id: 'message-7', matches: [start], start, current: new Map() };
  const state = taskMessageDefinition.start(base as never, start as never, {} as never);
  return { ...base, state };
}

describe('task-message Chat node Definition', () => {
  it('claims only append-surface messages with the task-message source', () => {
    expect(taskMessageDefinition.match(event())).toEqual({ id: 'message-7', role: 'start', exclusive: true });
    expect(taskMessageDefinition.match(event('user'))).toBeNull();
    expect(taskMessageDefinition.match(event('task-message', 'replace'))).toBeNull();
    expect(taskMessageDefinition.match({ type: 'assistant/message', seq: 1, data: {} } as never)).toBeNull();
  });

  it('builds a visible turn-level node at the message position', () => {
    const node = taskMessageDefinition.buildViewNode?.(context() as never) as unknown as Record<string, unknown>;
    expect(node).toMatchObject({
      key: 'context-key', kind: TASK_MESSAGE_NODE_KIND, id: 'message-7', target: 'chat',
      anchorSeq: 7, visibility: 'visible', groupTree: 'turn',
    });
    expect(node.data).toMatchObject({
      seq: 7,
      producer: { role: 'inject', label: 'task-message' },
      form: 'notice',
      content: [{ type: 'text', text: 'Message from task "Sender" (sender).' }],
    });
  });

  it('publishes nothing without assembled state', () => {
    expect(taskMessageDefinition.buildViewNode?.({ ...(context() as object), state: undefined } as never)).toBeNull();
  });
});
