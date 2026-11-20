// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ExportBoardsDialog } from '../../src/client/settings/boards/export-dialogs.js';
import { toBase64 } from '../../src/client/settings/boards/transfer-files.js';
import { fakeApi, fixture } from './helpers.js';
import { fakeFilePort } from './transfer-support.js';

afterEach(cleanup);

function mount(options: { withApi?: boolean; advisories?: Array<{ boardName: string; reason: 'external-script-source'; detail: string }> } = {}) {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  hub.boards = [...hub.boards, { ...hub.boards[0]!, id: 'board-2', name: 'Second board' }];
  const mock = fakeApi(data, {
    ...(options.withApi === false ? {} : {
      exportResult: { archive: toBase64(new Uint8Array([1, 2, 3])), fileName: 'kanban-workflows-hub.json.gz', boardCount: 1, advisories: options.advisories ?? [] },
    }),
  });
  const files = fakeFilePort();
  const user = userEvent.setup();
  render(<ExportBoardsDialog hub={hub} {...(options.withApi === false ? {} : { api: mock.api })} files={files} onClose={() => undefined} />);
  return { mock, files, user, hub };
}

describe('export dialog', () => {
  it('lists every board of the Hub with an inclusion control', () => {
    mount();
    expect(screen.getByRole('checkbox', { name: 'Include board Delivery' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Include board Second board' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('2 boards selected');
  });

  it('starts with every board selected and downloads the chosen subset', async () => {
    const { mock, files, user } = mount();
    await user.click(screen.getByRole('checkbox', { name: 'Include board Second board' }));
    expect(screen.getByRole('status').textContent).toContain('1 board selected');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(files.downloads).toHaveLength(1));
    expect(files.downloads[0]!.fileName).toBe('kanban-workflows-hub.json.gz');
    expect([...files.downloads[0]!.bytes]).toEqual([1, 2, 3]);
    expect(mock.api.exportWorkflows).toHaveBeenCalledWith({ hubId: 'hub-1', boardIds: ['board-1'] });
  });

  it('refuses an empty selection', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('0 boards selected');
  });

  it('reports an advisory for a board whose script reads an external file', async () => {
    const { user } = mount({ advisories: [{ boardName: 'Delivery', reason: 'external-script-source', detail: 'Plan reads ./run.sh' }] });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(screen.getByText(/Plan reads/)).toBeTruthy());
    expect(screen.getByText(/carry content it cannot transport/)).toBeTruthy();
  });

  it('offers no export action on a host without the read', () => {
    mount({ withApi: false });
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
