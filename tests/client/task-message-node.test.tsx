// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { TASK_MESSAGE_NODE_KIND, TaskMessageNodeView } from '../../src/client/task-message-node.js';
import type { NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);
const text = 'Message from task "Sender" (sender). Ship it.';
const node = {
  key: 'context-key', kind: TASK_MESSAGE_NODE_KIND, id: 'message-7', target: 'chat', anchorSeq: 7,
  location: { kind: 'unresolved' }, visibility: 'visible', groupTree: 'turn',
  data: {
    seq: 7, time: 1, content: [{ type: 'text', text }], source: { kind: 'task-message', form: 'notice', summary: 'Task message from Sender' },
    producer: { role: 'inject', label: 'task-message' }, form: 'notice',
  },
} as never;
const translate = ((key: string) => 't:' + key) as never;
function source(entry?: StoredEntry): NativeSlotSource {
  return {
    entriesOfSlot: () => entry === undefined ? [] : [entry],
    subscribe: () => () => {},
  };
}

describe('TaskMessageNodeView', () => {
  it('delegates to the host context-row component with the node payload and chat translator', () => {
    const entry = {
      component: (props: Record<string, unknown>) => <span data-testid="native-context">{String((props.node as { data: { content: readonly { text: string }[] } }).data.content[0]?.text)}:{(props.t as (key: string) => string)('message.contextInjection')}</span>,
      options: { key: 'context' },
    } as unknown as StoredEntry;
    render(<TaskMessageNodeView node={node} t={translate} slots={source(entry)} />);
    expect(screen.getByTestId('native-context').textContent).toBe(text + ':t:message.contextInjection');
  });

  it('contains a crashing host context row with the inline fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const entry = { component: () => { throw new Error('native context failed'); }, options: { key: 'context' } } as unknown as StoredEntry;
    render(<TaskMessageNodeView node={node} t={translate} slots={source(entry)} />);
    const fallback = screen.getByText('Task message from Sender').closest('details');
    expect(fallback?.textContent).toContain('Ship it.');
  });

  it('keeps an inline disclosure fallback when the host row is unavailable', () => {
    render(<TaskMessageNodeView node={node} t={translate} slots={source()} />);
    const summary = screen.getByText('Task message from Sender');
    const fallback = summary.closest('details');
    expect(fallback).toBeTruthy();
    expect(summary.tagName).toBe('SUMMARY');
    expect((summary as HTMLElement).style.display).not.toBe('flex');
    expect(fallback?.textContent).toContain('Ship it.');
    expect(fallback?.className).toContain('kb-task-message-fallback');
  });
});
