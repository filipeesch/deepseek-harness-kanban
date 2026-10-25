// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { TASK_CONTEXT_NODE_KIND, TaskContextNodeView } from '../../src/client/task-context-node.js';
import type { NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);
const node = {
  key: 'context-key', kind: TASK_CONTEXT_NODE_KIND, id: 'message-1', target: 'chat', anchorSeq: 5,
  location: { kind: 'unresolved' }, visibility: 'visible', groupTree: 'turn',
  data: {
    seq: 5, time: 1, content: [{ type: 'text', text: 'Task: Alpha' }], source: { kind: 'kanban-task' },
    producer: { role: 'inject', label: 'kanban-task' }, form: null,
  },
} as never;
const translate = ((key: string) => 't:' + key) as never;
function source(entry?: StoredEntry): NativeSlotSource {
  return {
    entriesOfSlot: () => entry === undefined ? [] : [entry],
    subscribe: () => () => {},
  };
}

describe('TaskContextNodeView', () => {
  it('delegates to the host context-row component with the node payload and chat translator', () => {
    const entry = {
      component: (props: Record<string, unknown>) => <span data-testid="native-context">{String((props.node as { data: { content: readonly { text: string }[] } }).data.content[0]?.text)}:{(props.t as (key: string) => string)('message.contextInjection')}</span>,
      options: { key: 'context' },
    } as unknown as StoredEntry;
    render(<TaskContextNodeView node={node} t={translate} slots={source(entry)} />);
    expect(screen.getByTestId('native-context').textContent).toBe('Task: Alpha:t:message.contextInjection');
  });

  it('contains a crashing host context row with the inline fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const entry = { component: () => { throw new Error('native context failed'); }, options: { key: 'context' } } as unknown as StoredEntry;
    render(<TaskContextNodeView node={node} t={translate} slots={source(entry)} />);
    const fallback = screen.getByText('Task context').closest('details');
    expect(fallback?.textContent).toContain('Task: Alpha');
  });

  it('keeps an inline disclosure fallback when the host row is unavailable', () => {
    render(<TaskContextNodeView node={node} t={translate} slots={source()} />);
    const fallback = screen.getByText('Task context').closest('details');
    expect(fallback).toBeTruthy();
    expect(fallback?.textContent).toContain('Task: Alpha');
    expect(fallback?.className).toContain('kb-task-context-fallback');
  });
});
