// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TaskFilesSection } from '../../src/client/task-files-section.js';
import { attachmentSize } from '../../src/attachments/bytes.js';
import type { Task } from '../../src/shared/types.js';

afterEach(cleanup);

function task(attachments?: Task['attachments']): Task {
  return { id: 'task-1', projectId: 'p', title: 'Evidence', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, ...(attachments === undefined ? {} : { attachments }), createdAt: 'now', updatedAt: 'now' };
}
const file = { id: 'att-1', name: 'report.csv', bytes: 2048, origin: 'path' as const };

describe('task file surface', () => {
  it('lists every attachment with its size and offers the actions', () => {
    render(<TaskFilesSection task={task([file])} run={vi.fn()} />);
    expect(screen.getByText('report.csv')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove report.csv' })).toBeTruthy();
  });

  it('states that the task has no files and still offers adding', () => {
    render(<TaskFilesSection task={task()} run={vi.fn()} />);
    expect(screen.getByText('This task has no files.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
  });

  it('offers one compact add action and no host-path field', () => {
    render(<TaskFilesSection task={task()} run={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Files for this task' })).toBeTruthy();
    expect(screen.getByLabelText('Attach files: choose a file')).toBeTruthy();
    expect(screen.queryByLabelText('Attachment host path')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('adds the picked bytes through one command', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockResolvedValue({});
    render(<TaskFilesSection task={task()} run={run} />);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.edit', taskId: 'task-1', attachmentUploads: [{ name: 'spec.pdf', origin: 'upload', data: 'YWJj' }] }));
  });

  it('adds a pasted file from the clipboard, never pasted text', async () => {
    const run = vi.fn().mockResolvedValue({});
    render(<TaskFilesSection task={task()} run={run} />);
    const surface = screen.getByRole('region', { name: 'Task files' });
    fireEvent.paste(surface, { clipboardData: { files: [new File(['abc'], 'pasted.png')] } });
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.edit', taskId: 'task-1', attachmentUploads: [{ name: 'pasted.png', origin: 'clipboard', data: 'YWJj' }] }));
    fireEvent.paste(surface, { clipboardData: { files: [], getData: () => 'just text' } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports an add failure with its ways out instead of hiding it', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockRejectedValue({ code: 'ATTACHMENT_NAME_INVALID', message: 'The file name has no usable characters.' });
    render(<TaskFilesSection task={task()} run={run} />);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('The file name has no usable characters.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard failed files' })).toBeTruthy();
  });

  it('keeps the add action unavailable until a failed selection is resolved', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockRejectedValueOnce({ code: 'ATTACHMENT_NAME_INVALID', message: 'The file name has no usable characters.' });
    render(<TaskFilesSection task={task()} run={run} />);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await screen.findByRole('alert');
    const attach = screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement;
    expect(attach.disabled).toBe(true);
    // Neither source takes another file while the surface waits for a decision.
    const surface = screen.getByRole('region', { name: 'Task files' });
    fireEvent.paste(surface, { clipboardData: { files: [new File(['abc'], 'blocked.txt')] } });
    expect(run).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    expect((screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.paste(surface, { clipboardData: { files: [new File(['abc'], 'after.txt')] } });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('confirms before removing and sends no command until confirmed', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockResolvedValue({});
    render(<TaskFilesSection task={task([file])} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Remove report.csv' }));
    expect(screen.getByText(/deletes its stored bytes/)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.edit', taskId: 'task-1', removeAttachmentIds: ['att-1'], confirmed: true }));
  });

  it('leaves the file alone when the removal is canceled', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockResolvedValue({});
    render(<TaskFilesSection task={task([file])} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Remove report.csv' }));
    await user.click(screen.getByRole('button', { name: 'Keep the file' }));
    expect(screen.queryByText(/deletes its stored bytes/)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('downloads through the authenticated route with the recorded filename', async () => {
    const user = userEvent.setup();
    // The route answers with the bytes and a disposition header, so the browser saves
    // them natively and this surface never buffers a payload.
    let href = '';
    let download = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { href = this.getAttribute('href') ?? ''; download = this.download; });
    render(<TaskFilesSection task={task([file])} hubId='hub-1' run={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Download report.csv' }));
    // The browser-relative form has no leading slash; the registered route constant is
    // the single source of that path.
    expect(href).toBe('api/kanban/attachments?taskId=task-1&attachmentId=att-1&hubId=hub-1');
    expect(download).toBe('report.csv');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('offers download even when the read RPC is absent, because the route serves the bytes', () => {
    render(<TaskFilesSection task={task([file])} run={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Download report.csv' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('formats attachment sizes in readable units', () => {
    expect(attachmentSize(512)).toBe('512 B');
    expect(attachmentSize(2048)).toBe('2.0 KB');
    expect(attachmentSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
