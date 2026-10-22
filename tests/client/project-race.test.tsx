// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import type { BoardSnapshot } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

async function startProjectSave() {
  const mock = fakeApi(); let resolve!: (result: BoardSnapshot) => void; let reject!: (error: unknown) => void;
  mock.command.mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Configuration' }));
  await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created X'); await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/projects/x'); await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/projects');
  await user.click(screen.getByRole('button', { name: 'Save project' }));
  return { ...mock, user, resolve, reject };
}

function createdX(receipt = true): BoardSnapshot {
  const result = fixture(); result.sequence = 2; result.state.revision = 2; result.state.projects.push({ id: 'created-x', name: 'Created X', projectPath: '/projects/x', gitRootPath: '/projects' });
  if (receipt) result.commandReceipt = { kind: 'project', id: 'created-x' };
  return result;
}

describe('project draft lifetime during save', () => {
  it('never combines a pending X creation receipt with fields from an attempted Y selection', async () => {
    const mock = await startProjectSave();
    await mock.user.click(screen.getByRole('button', { name: 'Edit project Web' }));
    const result = createdX(); act(() => { const feed = { ...result }; delete feed.commandReceipt; mock.publish(feed); mock.resolve(result); });
    await screen.findByText('Project saved.');
    await mock.user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2));
    expect(mock.command.mock.calls[1]![0]).not.toEqual(expect.objectContaining({ type: 'project.save', project: expect.objectContaining({ id: 'created-x', name: 'Web', projectPath: '/web' }) }));
  });

  it.each(['receipt', 'missing receipt', 'error'] as const)('locks New/Edit and draft fields for the entire save, then safely selects Y after %s', async outcome => {
    const mock = await startProjectSave();
    expect((screen.getByRole('button', { name: 'New project' }) as HTMLButtonElement).disabled).toBe(true);
    for (const button of screen.getAllByRole('button', { name: /Edit project/ })) expect((button as HTMLButtonElement).disabled).toBe(true);
    for (const name of ['Project name', 'Project path', 'Git root', 'Default branch (optional)']) expect((screen.getByRole('textbox', { name }) as HTMLInputElement).disabled).toBe(true);
    await mock.user.click(screen.getByRole('button', { name: 'New project' })); await mock.user.click(screen.getByRole('button', { name: 'Edit project Web' })); await mock.user.type(screen.getByRole('textbox', { name: 'Project name' }), 'UNINTENDED');
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Created X'); expect(mock.command).toHaveBeenCalledTimes(1);
    if (outcome === 'error') await act(async () => { mock.reject({ code: 'SAVE_FAILED', message: 'The save could not complete.' }); });
    else { const result = createdX(outcome === 'receipt'); await act(async () => { const feed = { ...result }; delete feed.commandReceipt; mock.publish(feed); mock.resolve(result); }); }
    await waitFor(() => expect((screen.getByRole('button', { name: 'New project' }) as HTMLButtonElement).disabled).toBe(false));
    if (outcome === 'missing receipt') expect(screen.getByText('CREATION_RECEIPT_REQUIRED')).toBeTruthy();
    if (outcome === 'error') expect(screen.getByText('SAVE_FAILED')).toBeTruthy();
    await mock.user.click(screen.getByRole('button', { name: 'Edit project Web' })); await mock.user.clear(screen.getByRole('textbox', { name: 'Project name' })); await mock.user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Updated Y'); await mock.user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2));
    expect(mock.command.mock.calls[1]![0]).toEqual(expect.objectContaining({ type: 'project.save', project: expect.objectContaining({ id: 'p2', name: 'Updated Y', projectPath: '/web', gitRootPath: '/web' }) }));
  });

  it('also locks project selection during an existing-project edit that has no creation receipt', async () => {
    const mock = fakeApi(); let resolve!: (value: BoardSnapshot) => void; mock.command.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('button', { name: 'Edit project API' })); await user.clear(screen.getByRole('textbox', { name: 'Project name' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Edited API'); await user.click(screen.getByRole('button', { name: 'Save project' }));
    await user.click(screen.getByRole('button', { name: 'Edit project Web' })); await user.click(screen.getByRole('button', { name: 'New project' }));
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Edited API');
    const result = fixture(); result.sequence = 2; result.state.revision = 2; result.state.projects[0]!.name = 'Edited API'; await act(async () => { mock.publish(result); resolve(result); }); await screen.findByText('Project saved.'); await user.click(screen.getByRole('button', { name: 'Save project' })); await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2)); expect(mock.command.mock.calls[1]![0]).toEqual(expect.objectContaining({ type: 'project.save', project: expect.objectContaining({ id: 'p1', name: 'Edited API', projectPath: '/repo/apps/api' }) }));
  });

  it.each(['receipt', 'missing receipt', 'error'] as const)('does not apply a late %s completion to a remounted editor for Y', async outcome => {
    const mock = await startProjectSave(); await mock.user.click(screen.getByRole('button', { name: 'Close Kanban configuration' })); await mock.user.click(screen.getByRole('button', { name: 'Configuration' })); await mock.user.click(screen.getByRole('button', { name: 'Edit project Web' }));
    if (outcome === 'error') await act(async () => { mock.reject({ code: 'OLD_SAVE_FAILED', message: 'Failure belongs to the prior editor.' }); });
    else { const result = createdX(outcome === 'receipt'); await act(async () => { const feed = { ...result }; delete feed.commandReceipt; mock.publish(feed); mock.resolve(result); }); }
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Web'); expect(screen.queryByText('CREATION_RECEIPT_REQUIRED')).toBeNull(); expect(screen.queryByText('OLD_SAVE_FAILED')).toBeNull();
    await mock.user.click(screen.getByRole('button', { name: 'Save project' })); await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2)); expect(mock.command.mock.calls[1]![0]).toEqual(expect.objectContaining({ type: 'project.save', project: expect.objectContaining({ id: 'p2', name: 'Web', projectPath: '/web' }) }));
  });
});
