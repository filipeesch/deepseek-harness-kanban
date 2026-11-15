// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import { FeedStatus } from '../../src/client/feed-status.js';
import type { BridgeStatus } from '../../src/client-bridge.js';

function source(value: BridgeStatus): HostObservable<BridgeStatus> {
  return { getSnapshot: () => value, subscribe: () => () => {} };
}

afterEach(cleanup);

describe('board update status', () => {
  it('presents nothing while the live board feed is available', () => {
    const { container } = render(<FeedStatus status={source({ error: null })} retry={() => {}} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the live feed failure and restarts the feed from its retry', () => {
    const retry = vi.fn();
    render(<FeedStatus status={source({ error: { code: 'STREAM_FAILED', message: 'Kanban state stream ended; reconnecting.' } })} retry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('Kanban updates are unavailable: Kanban state stream ended; reconnecting.');
    screen.getByRole('button', { name: 'Retry updates' }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
