// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { NewTaskDialog } from '../../src/client/forms.js';
import type { BoardState, Command, KanbanSnapshot, Project } from '../../src/shared/types.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project = { id: 'p1', projectKey: 'p1', name: 'API', projectPath: '/repo', gitRootPath: '/repo', defaultBranch: 'main' } as Project;
const state: BoardState = {
  schemaVersion: 2,
  revision: 1,
  workflowYaml: 'name: Flow',
  workflow: { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] },
  projects: [project],
  tasks: [],
  notes: [],
};

/** A run that reports one created task, so the dialog accepts the receipt. */
function created(id = 't9') {
  const commands: Command[] = [];
  const run = vi.fn(async (command: Command) => {
    commands.push(command);
    return { commandReceipt: { kind: 'task', id }, state: { hubs: [{ tasks: [{ id }] }] } } as unknown as KanbanSnapshot;
  });
  return { commands, run };
}

function dialog(run: (command: Command) => Promise<KanbanSnapshot>) {
  return render(<NewTaskDialog state={state} projects={[project]} closedForCreation={false} run={run} onClose={vi.fn()} onCreated={vi.fn()} />);
}

/** A FileReader a test releases by hand, so a read really is in flight. */
function gatedReader() {
  const pending: Array<() => void> = [];
  class GatedFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(): void {
      pending.push(() => {
        this.result = 'data:application/octet-stream;base64,YWJj';
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('FileReader', GatedFileReader);
  return { releaseAll: () => { for (const release of pending.splice(0)) release(); } };
}

async function fillTitle(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Carry the evidence');
  await user.selectOptions(screen.getByLabelText('Project'), 'p1');
}

describe('new task dialog files', () => {
  it('offers one compact attach action and no host-path field', () => {
    dialog(created().run);
    expect(screen.queryByLabelText('Attachment host path')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add path' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a file' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Files for this task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
    expect(screen.getByLabelText('Attach files: choose a file')).toBeTruthy();
  });

  it('lists a picked file as a token with its size and a removal', async () => {
    const user = userEvent.setup();
    dialog(created().run);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeTruthy());
    expect(screen.getByText('3 B')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove spec.pdf' }));
    expect(screen.queryByText('spec.pdf')).toBeNull();
  });

  it('creates the task carrying the picked bytes and no path attachment', async () => {
    const user = userEvent.setup();
    const recorded = created();
    dialog(recorded.run);
    await fillTitle(user);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    const command = recorded.commands[0]!;
    expect(command.type).toBe('task.create');
    expect((command as { attachmentUploads?: unknown }).attachmentUploads).toEqual([{ name: 'spec.pdf', origin: 'upload', data: 'YWJj' }]);
    expect(command).not.toHaveProperty('attachments');
  });

  it('waits for a read in flight instead of creating the task without it', async () => {
    const user = userEvent.setup();
    const reader = gatedReader();
    const recorded = created();
    dialog(recorded.run);
    await fillTitle(user);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    // The read has not finished, so Create is unavailable and says why.
    const create = screen.getByRole('button', { name: 'Reading files…' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    reader.releaseAll();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]).toMatchObject({ attachmentUploads: [{ name: 'spec.pdf', origin: 'upload' }] });
  });

  it('reports a failed read, blocks creation, and proceeds once the selection is discarded', async () => {
    const user = userEvent.setup();
    class FailingFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(): void { this.onerror?.(); }
    }
    vi.stubGlobal('FileReader', FailingFileReader);
    const recorded = created();
    dialog(recorded.run);
    await fillTitle(user);
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('The file "spec.pdf" could not be read.');
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]).toMatchObject({ title: 'Carry the evidence' });
  });

  it('stores nothing when one file of a batch cannot be read, and a retry stores each file once', async () => {
    const user = userEvent.setup();
    // The first attempt cannot read bad.txt; the retry reads every file.
    let attempts = 0;
    class BatchFileReader {
      result: string | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File): void {
        if (file.name === 'bad.txt' && attempts === 0) {
          this.error = new Error('The requested file could not be read');
          this.onerror?.();
          return;
        }
        this.result = 'data:application/octet-stream;base64,YWJj';
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', BatchFileReader);
    const recorded = created();
    dialog(recorded.run);
    await fillTitle(user);
    attempts = 0;
    await user.upload(screen.getByLabelText('Attach files: choose a file') as HTMLInputElement, [new File(['abc'], 'good.txt'), new File(['abc'], 'bad.txt')]);
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('The file "bad.txt" could not be read.');
    // The readable file of the failed batch is not kept as a partial selection.
    expect(screen.queryByText('good.txt')).toBeNull();
    expect(recorded.commands).toHaveLength(0);
    attempts = 1;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('good.txt')).toBeTruthy());
    expect(screen.getByText('bad.txt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect((recorded.commands[0] as { attachmentUploads?: unknown[] }).attachmentUploads).toHaveLength(2);
  });

  it('takes no attachment once the creation is in flight', async () => {
    const user = userEvent.setup();
    // A creation that never settles keeps the dialog in its saving state.
    const run = vi.fn(() => new Promise<KanbanSnapshot>(() => {}));
    dialog(run as (command: Command) => Promise<KanbanSnapshot>);
    await fillTitle(user);
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    // The command is already fixed, so a late paste must not appear as a token.
    fireEvent.paste(screen.getByLabelText('Title'), { clipboardData: { files: [new File(['abc'], 'late.txt')] } });
    expect(screen.queryByText('late.txt')).toBeNull();
    // The command that went out carries no attachment, matching what the person sees.
    expect((run.mock.calls[0] as unknown as [Command])[0]).not.toHaveProperty('attachmentUploads');
  });

  it('attaches a file pasted anywhere in the dialog', async () => {
    const user = userEvent.setup();
    const recorded = created();
    dialog(recorded.run);
    await fillTitle(user);
    fireEvent.paste(screen.getByLabelText('Title'), { clipboardData: { files: [new File(['abc'], 'pasted.png')] } });
    await waitFor(() => expect(screen.getByText('pasted.png')).toBeTruthy());
    // A text-only paste never becomes an attachment.
    fireEvent.paste(screen.getByLabelText('Title'), { clipboardData: { files: [], getData: () => 'just text' } });
    await waitFor(() => expect(screen.getAllByTitle('pasted.png')).toHaveLength(1));
  });
});
