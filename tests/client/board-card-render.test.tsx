// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { BoardView } from '../../src/client/board.js';
import { autoModeView } from '../../src/client/auto-mode.js';
import type { ClientApi, KanbanSnapshot } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
      React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

vi.mock('../../src/client/auto-mode.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/client/auto-mode.js')>();
  return { ...actual, autoModeView: vi.fn(actual.autoModeView) };
});

afterEach(cleanup);

describe('board card render isolation', () => {
  it('re-renders only the card whose attention changed', async () => {
    const data = fixture();
    let notify: ((snapshot: KanbanSnapshot) => void) | undefined;
    const api: ClientApi = {
      snapshot: vi.fn(async () => data),
      command: vi.fn(async () => data),
      sharing: vi.fn(async () => data),
      localDrive: vi.fn(async (request: { action: string; path?: string }) => request.action === 'roots' ? { action: 'roots' as const, discovery: { state: 'empty' as const, locations: [] } } : { action: 'list' as const, page: { rootId: '/drive', path: '/drive', parent: null, entries: [], hasDocument: false, truncated: false, shown: 0 } }),
      branches: vi.fn(async () => []),
      worktreeDefault: vi.fn(async () => ({ branchName: 'task', path: '' })),
      detectProject: vi.fn(async (pathValue: string) => ({ kind: 'folder' as const, projectPath: pathValue })),
      subscribe: vi.fn(listener => { notify = listener; return () => {}; }),
    };
    render(<BoardView api={api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    const view = vi.mocked(autoModeView);
    await waitFor(() => expect(view).toHaveBeenCalled());
    view.mockClear();

    const next: KanbanSnapshot = {
      ...data,
      sequence: data.sequence + 1,
      attention: { ...data.attention, t1: { ...data.attention.t1!, unread: false } },
    };
    act(() => notify!(next));
    await waitFor(() => expect(view).toHaveBeenCalled());
    // Only the card whose attention object changed re-derived its auto-mode view.
    expect(view).toHaveBeenCalledTimes(1);
  });
});
