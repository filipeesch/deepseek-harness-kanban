// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { STAGE_NOTICE_NODE_KIND, StageNoticeNodeView } from '../../src/client/stage-notice-node.js';
import type { NativeSlotSource } from '../../src/client/native-slot-host.js';

afterEach(cleanup);
const node = {
  key: 'notice-key', kind: STAGE_NOTICE_NODE_KIND, id: 'message-9', target: 'chat', anchorSeq: 7,
  location: { kind: 'unresolved' }, visibility: 'visible', groupTree: 'turn',
  data: {
    seq: 7, time: 1, content: [{ type: 'text', text: 'Stage notice: the task is now in the Review stage.' }], source: { kind: 'stage-notice', form: 'notice', summary: 'Stage: Review' },
    producer: { role: 'inject', label: 'stage-notice' }, form: 'notice',
  },
} as never;
const translate = ((key: string) => 't:' + key) as never;
function source(entry?: StoredEntry): NativeSlotSource {
  return { entriesOfSlot: () => entry === undefined ? [] : [entry], subscribe: () => () => {} };
}

describe('StageNoticeNodeView', () => {
  it('delegates to the host context-row component with the node payload', () => {
    const entry = {
      component: (props: Record<string, unknown>) => <span data-testid="native-context">{String((props.node as { data: { content: readonly { text: string }[] } }).data.content[0]?.text)}</span>,
      options: { key: 'context' },
    } as unknown as StoredEntry;
    render(<StageNoticeNodeView node={node} t={translate} slots={source(entry)} />);
    expect(screen.getByTestId('native-context').textContent).toBe('Stage notice: the task is now in the Review stage.');
  });

  it('contains a crashing host context row with the inline fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const entry = { component: () => { throw new Error('native context failed'); }, options: { key: 'context' } } as unknown as StoredEntry;
    render(<StageNoticeNodeView node={node} t={translate} slots={source(entry)} />);
    expect(screen.getByText('Stage: Review').closest('details')?.textContent).toContain('the task is now in the Review stage');
  });

  it('keeps an inline disclosure fallback, styled as a stage row, when the host row is unavailable', () => {
    render(<StageNoticeNodeView node={node} t={translate} slots={source()} />);
    const fallback = screen.getByText('Stage: Review').closest('details');
    expect(fallback).toBeTruthy();
    expect(fallback?.textContent).toContain('the task is now in the Review stage');
    expect(fallback?.className).toContain('kb-stage-context-fallback');
  });

  it('falls back to the static title when the source carries no summary', () => {
    const bare = { ...(node as object), data: { ...(node as { data: object }).data, source: { kind: 'stage-notice' } } } as never;
    render(<StageNoticeNodeView node={bare} t={translate} slots={source()} />);
    expect(screen.getByText('Stage notice').closest('details')).toBeTruthy();
  });
});
