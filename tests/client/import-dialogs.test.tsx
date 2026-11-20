// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ImportBoardsDialog } from '../../src/client/settings/boards/import-dialogs.js';
import type { WorkflowImportEntry, WorkflowImportPlan } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';
import { fakeFilePort } from './transfer-support.js';

afterEach(cleanup);

function entry(overrides: Partial<WorkflowImportEntry> = {}): WorkflowImportEntry {
  return {
    name: 'Imported', destination: 'create', targetBoardId: null, copyName: null,
    orphaned: [], realigned: [], droppedProjectKeys: [], scopeOpened: false,
    blockReason: null, detail: null, externalScriptSources: [],
    ...overrides,
  };
}

function conflict(overrides: Partial<WorkflowImportEntry> = {}): WorkflowImportEntry {
  return entry({ name: 'Delivery', destination: 'blocked', targetBoardId: 'board-1', copyName: 'Delivery (imported)', blockReason: 'name-conflict', detail: 'A board with this name already exists in this Hub.', ...overrides });
}

function plan(entries: WorkflowImportEntry[]): WorkflowImportPlan { return { hubId: 'hub-1', origin: 'Other Hub', entries }; }

function mount(options: { entries?: WorkflowImportEntry[]; chosen?: { fileName: string; bytes: Uint8Array } | null; withApi?: boolean } = {}) {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  const mock = fakeApi(data, options.withApi === false ? {} : { importPlan: plan(options.entries ?? [entry(), conflict()]) });
  const files = fakeFilePort(options.chosen === undefined ? { chosen: { fileName: 'export.json.gz', bytes: new Uint8Array([1, 2]) } } : { chosen: options.chosen });
  const user = userEvent.setup();
  render(<ImportBoardsDialog hub={hub} {...(options.withApi === false ? {} : { api: mock.api })} files={files} run={async request => mock.api.command(request as never)} onClose={() => undefined} />);
  return { mock, files, user, hub };
}

async function choose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Choose file/ }));
  await screen.findByText('Import workflows');
}

describe('import dialog', () => {
  it('reads the chosen file and lists every entry with its destination', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Imported')).toBeTruthy());
    expect(screen.getByText(/Other Hub/)).toBeTruthy();
    expect(screen.getByText('creates a new board')).toBeTruthy();
    // The shared policy starts on Create a copy, so the conflict states the copy it would add.
    expect(screen.getByText('creates a copy as "Delivery (imported)"')).toBeTruthy();
  });

  it('applies the shared policy to every conflict', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('is left unchanged')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    // The row names the board a replacement would overwrite, not a generic phrase.
    expect(screen.getByText('replaces "Delivery"')).toBeTruthy();
  });

  it('lets one conflict be overridden', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'replace Delivery' }));
    expect(screen.getByRole('button', { name: 'replace Delivery' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('reports the result of applying', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText('Import finished.')).toBeTruthy());
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('blocks applying while a copy name is empty', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    const input = screen.getByRole('textbox', { name: 'Copy name for Delivery' });
    await user.clear(input);
    expect(screen.getByRole('alert').textContent).toContain('A copy needs a name.');
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks applying while a copy name matches an existing board', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    const input = screen.getByRole('textbox', { name: 'Copy name for Delivery' });
    await user.clear(input);
    await user.type(input, 'delivery');
    expect(screen.getByRole('alert').textContent).toContain('already exists');
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks applying while two copies share a name', async () => {
    const { user } = mount({ entries: [conflict({ name: 'Delivery' }), conflict({ name: 'Review', targetBoardId: 'board-1', copyName: 'Review (imported)' })] });
    await choose(user);
    await waitFor(() => expect(screen.getByText('Review')).toBeTruthy());
    const input = screen.getByRole('textbox', { name: 'Copy name for Review' });
    await user.clear(input);
    await user.type(input, 'Delivery (imported)');
    expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Another copy'))).toBe(true);
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports an unreadable file when it is chosen', async () => {
    const { user } = mount({ withApi: false });
    await user.click(screen.getByRole('button', { name: /Choose file/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot read'));
    expect(screen.queryByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('keeps the surface open after applying', async () => {
    const { user } = mount();
    await choose(user);
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText('Import finished.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
