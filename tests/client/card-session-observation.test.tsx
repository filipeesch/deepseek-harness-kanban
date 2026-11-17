// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoardView } from '../../src/client/board.js';
import type { ClientApi, KanbanSnapshot } from '../../src/shared/types.js';
import { UNREADABLE_SESSION_CODE } from '../../src/domain/session-observation.js';
import { fixture } from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
      React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);

function apiFor(data: KanbanSnapshot): ClientApi {
  return {
    snapshot: vi.fn(async () => data),
    command: vi.fn(async () => data),
    sharing: vi.fn(async () => data),
    localDrive: vi.fn(async (request: { action: string }) => request.action === 'roots' ? { action: 'roots' as const, discovery: { state: 'empty' as const, locations: [] } } : { action: 'list' as const, page: { rootId: '/drive', path: '/drive', parent: null, entries: [], hasDocument: false, truncated: false, shown: 0 } }),
    branches: vi.fn(async () => []),
    modelCatalog: vi.fn(async () => ({ default: { provider: 'deepseek', model: 'chat' }, providers: [], failures: [] })),
    worktreeDefault: vi.fn(async () => ({ kind: 'derived' as const, branchName: 'task', path: '/worktrees/task' })),
    detectProject: vi.fn(async (pathValue: string) => ({ kind: 'folder' as const, projectPath: pathValue })),
    subscribe: vi.fn(() => () => {}),
  } as ClientApi;
}

describe('card Session observation status', () => {
  it('presents the state on the card whose conversation could not be observed', async () => {
    const data: KanbanSnapshot = {
      ...fixture(),
      conversationObservations: {
        s1: { state: 'unreadable', cause: 'stored session failed validation: PTC dispatch repeats subCallId' },
      },
    };
    render(<BoardView api={apiFor(data)} renderConversation={() => null} />);
    expect(await screen.findByText('Session log unreadable')).toBeTruthy();
    expect(screen.getAllByText('Session log unreadable')).toHaveLength(1);
  });

  it('keeps the card openable while the status is presented', async () => {
    const data: KanbanSnapshot = {
      ...fixture(),
      conversationObservations: { s1: { state: 'missing', cause: 'no stored log' } },
    };
    render(<BoardView api={apiFor(data)} renderConversation={() => null} />);
    await screen.findByText('Session log missing');
    const open = screen.getByRole('button', { name: 'Open task Alpha task' });
    expect(open.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Open task Beta task' }).hasAttribute('disabled')).toBe(false);
  });

  it('presents nothing while every conversation is observed', async () => {
    render(<BoardView api={apiFor(fixture())} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    expect(screen.queryByText('Session log unreadable')).toBeNull();
    expect(screen.queryByText('Session log missing')).toBeNull();
  });

  it('prefers the unreadable state when a task has both', async () => {
    const data: KanbanSnapshot = {
      ...fixture(),
      conversationObservations: {
        s1: { state: 'missing', cause: 'no stored log' },
        s2: { state: 'unreadable', cause: 'stored session failed validation' },
      },
    };
    render(<BoardView api={apiFor(data)} renderConversation={() => null} />);
    await screen.findByText('Session log unreadable');
    expect(screen.queryByText('Session log missing')).toBeNull();
    expect(UNREADABLE_SESSION_CODE).toBe('SESSION_QUERY_CORRUPT_SESSION');
  });
});
