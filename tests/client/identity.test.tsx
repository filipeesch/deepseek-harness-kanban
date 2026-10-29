// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView, createBoardPageState } from '../../src/client/board.js';
import { fakeApi, fixture, task } from './helpers.js';

afterEach(cleanup);

describe('authoritative command creation identity', () => {
  it('opens the exact task receipt when a stale UI receives concurrent tool and UI creations', async () => {
    const initial = fixture(); initial.state.tasks = []; const mock = fakeApi(initial); const result = fixture();
    result.sequence = 2; result.commandReceipt = { kind: 'task', id: 'ui-y' };
    result.state.tasks = [
      { ...task('tool-x', 'Concurrent task', 'p1', 'intake'), sessionIds: ['tool-x-session'] },
      { ...task('ui-y', 'Concurrent task', 'p1', 'intake'), sessionIds: ['ui-y-session'] },
    ];
    mock.command.mockResolvedValueOnce(result);
    const renderer = vi.fn((id: string) => <span>Native session {id}</span>); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={renderer} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'New task' })); await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Concurrent task'); await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'p1'); await user.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByRole('button', { name: 'Close task details' });
    expect(renderer).toHaveBeenLastCalledWith('ui-y-session', undefined);
    expect(renderer.mock.calls.some(([id]) => id === 'tool-x-session')).toBe(false);
  });

  it.each(['missing', 'mismatched'] as const)('fails closed on a %s task creation receipt without guessing another new task', async mode => {
    const initial = fixture(); initial.state.tasks = []; const mock = fakeApi(initial); const result = fixture(); result.sequence = 2;
    result.state.tasks = [{ ...task('tool-x', 'Concurrent task', 'p1', 'intake'), sessionIds: ['tool-x-session'] }, { ...task('ui-y', 'Concurrent task', 'p1', 'intake'), sessionIds: ['ui-y-session'] }];
    if (mode === 'mismatched') result.commandReceipt = { kind: 'project', id: 'ui-y' };
    mock.command.mockResolvedValueOnce(result); const renderer = vi.fn((id: string) => <span>{id}</span>); const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={renderer} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(false)); await user.click(screen.getByRole('button', { name: 'New task' })); await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Concurrent task'); await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'p1'); await user.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText('CREATION_RECEIPT_REQUIRED'); expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy(); expect(screen.getByText(/inspect or refresh the board/)).toBeTruthy(); expect(renderer).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull(); expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true); expect(mock.command).toHaveBeenCalledTimes(1);
  });

  it('does not open a different task when the received exact task ID is unavailable', async () => {
    const initial = fixture(); initial.state.tasks = []; const mock = fakeApi(initial); const result = fixture(); result.sequence = 2; result.commandReceipt = { kind: 'task', id: 'absent-y' }; result.state.tasks = [task('tool-x', 'Concurrent task', 'p1', 'intake')]; mock.command.mockResolvedValueOnce(result);
    const renderer = vi.fn((id: string) => <span>{id}</span>); const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={renderer} />); await waitFor(() => expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(false)); await user.click(screen.getByRole('button', { name: 'New task' })); await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Concurrent task'); await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'p1'); await user.click(screen.getByRole('button', { name: 'Create task' })); await screen.findByText('CREATED_TASK_UNAVAILABLE'); expect(renderer).not.toHaveBeenCalled();
  });

  it('binds subsequent project edits to the exact project creation receipt under concurrent creation', async () => {
    const mock = fakeApi(); const result = fixture(); result.sequence = 2; result.state.revision = 2; result.commandReceipt = { kind: 'project', id: 'project-y' }; result.state.projects.push({ id: 'project-x', name: 'Worker', projectPath: '/other/worker', gitRootPath: '/other' }, { id: 'project-y', name: 'Worker', projectPath: '/repo/apps/worker', gitRootPath: '/repo' });
    mock.command.mockImplementationOnce(async () => { const feed = { ...result }; delete feed.commandReceipt; mock.publish(feed); return result; });
    const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' })); await user.click(screen.getByRole('button', { name: 'New project' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker'); await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/worker'); await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/repo'); await user.click(screen.getByRole('button', { name: 'Save project' })); await screen.findByText('Project saved.'); const workerRow = screen.getAllByRole('button', { name: 'Edit project Worker' }).find(button => button.closest('li')?.textContent?.includes('/repo/apps/worker') ?? false);
    await user.click(workerRow!); await user.clear(screen.getByRole('textbox', { name: 'Project name' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Updated Worker'); await user.click(screen.getByRole('button', { name: 'Save project' })); await waitFor(() => expect(mock.command).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'project.save', project: { id: 'project-y', name: 'Updated Worker', projectPath: '/repo/apps/worker', gitRootPath: '/repo' } })));
  });

  it('does not bind a missing project receipt to the first unfamiliar project', async () => {
    const mock = fakeApi(); const result = fixture(); result.sequence = 2; result.state.projects.push({ id: 'project-x', name: 'Worker X', projectPath: '/other/worker', gitRootPath: '/other' }, { id: 'project-y', name: 'Worker Y', projectPath: '/repo/apps/worker', gitRootPath: '/repo' }); mock.command.mockResolvedValueOnce(result);
    const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={() => null} />); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' })); await user.click(screen.getByRole('button', { name: 'New project' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker Y'); await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/worker'); await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/repo'); await user.click(screen.getByRole('button', { name: 'Save project' })); await screen.findByText('CREATION_RECEIPT_REQUIRED'); expect(screen.getByRole('form', { name: 'New project' })).toBeTruthy(); expect(screen.queryByRole('form', { name: 'Edit project' })).toBeNull(); expect((screen.getByRole('button', { name: 'Save project' }) as HTMLButtonElement).disabled).toBe(true); expect(mock.command).toHaveBeenCalledTimes(1);
  });

  it('selects the exact new conversation receipt when another actor adds a tab concurrently', async () => {
    const mock = fakeApi(); const result = fixture(); result.sequence = 2; result.commandReceipt = { kind: 'conversation', id: 'ui-y-session' }; result.state.tasks[0]!.sessionIds.push('tool-x-session', 'ui-y-session'); mock.command.mockImplementationOnce(async () => { const feed = { ...result }; delete feed.commandReceipt; mock.publish(feed); return result; });
    const renderer = vi.fn((id: string) => <span>{id}</span>); const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={renderer} />); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Open task Alpha task' })); await user.click(screen.getByRole('button', { name: 'New conversation' })); await waitFor(() => expect(renderer).toHaveBeenLastCalledWith('ui-y-session', undefined)); expect(renderer.mock.calls.some(([id]) => id === 'tool-x-session')).toBe(false); expect(screen.getByRole('tab', { name: 'Agent 4' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not default to a concurrently created conversation when all prior tabs were closed and the receipt is missing', async () => {
    const initial = fixture(); initial.state.tasks[0]!.closedSessionIds = ['s1', 's2']; const mock = fakeApi(initial); const pageState = createBoardPageState(); const result = fixture(); result.sequence = 2; result.state.tasks[0]!.closedSessionIds = ['s1', 's2']; result.state.tasks[0]!.sessionIds.push('tool-x-session', 'ui-y-session'); let resolve!: (snapshot: ReturnType<typeof fixture>) => void; mock.command.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const renderer = vi.fn((id: string) => <span>{id}</span>); const user = userEvent.setup(); const first = render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderer} />); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Open task Alpha task' })); await user.click(screen.getByRole('button', { name: 'New conversation' })); act(() => { mock.publish(result); }); expect(renderer).not.toHaveBeenCalled(); await act(async () => { resolve(result); }); await screen.findByText('CREATION_RECEIPT_REQUIRED'); expect(renderer).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount(); render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderer} />); await screen.findByRole('button', { name: 'Close task details' }); expect(renderer).not.toHaveBeenCalled(); await user.click(screen.getByRole('tab', { name: 'Agent 4' })); expect(renderer).toHaveBeenLastCalledWith('ui-y-session', undefined);
  });

  it('mock create commands emit transient exact receipts without persisting or following them', async () => {
    const mock = fakeApi(); const listener = vi.fn(); mock.api.subscribe(listener); const result = await mock.api.command({ type: 'task.create', title: 'Created', description: '', projectId: 'p1' }); expect(result.commandReceipt).toEqual({ kind: 'task', id: 't3' }); expect(mock.get().commandReceipt).toBeUndefined(); expect((await mock.api.snapshot()).commandReceipt).toBeUndefined(); expect(listener.mock.calls[0]![0].commandReceipt).toBeUndefined(); mock.publish(result); expect(mock.get().commandReceipt).toBeUndefined(); expect(listener.mock.calls.at(-1)![0].commandReceipt).toBeUndefined(); const edited = await mock.api.command({ type: 'task.edit', taskId: 't3', title: 'Edited' }); expect(edited.commandReceipt).toBeUndefined();
  });
});
