// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriveFolderPicker, breadcrumb, isInsideLocation, type DriveBrowserPort } from '../../src/client/settings/team-settings/drive-folder-picker.js';
import type { DriveBrowseView, DriveDiscoveryView } from '../../src/shared/types.js';

afterEach(cleanup);

const ROOT = '/Users/member/Drive';
const MY_DRIVE = ROOT + '/My Drive';
const PROJECTS = MY_DRIVE + '/Projetos';

const roots: DriveDiscoveryView = { state: 'ready', locations: [{ id: ROOT, rootPath: ROOT, kind: 'account', status: 'available', account: 'member@example.test' }] };
function page(path: string, entries: Array<{ name: string; path: string; group?: { id: 'my-drive' | 'shared-drives'; label: string } }>, hasDocument = false, parent: string | null = ROOT): DriveBrowseView {
  return { rootId: ROOT, path, parent, entries, hasDocument, truncated: false, shown: entries.length };
}
const pages: Record<string, DriveBrowseView> = {
  [ROOT]: page(ROOT, [{ name: 'My Drive', path: MY_DRIVE, group: { id: 'my-drive', label: 'My Drive' } }, { name: 'Unrecognized', path: ROOT + '/Unrecognized' }], false, null),
  [MY_DRIVE]: page(MY_DRIVE, [{ name: 'Projetos', path: PROJECTS }, { name: 'Time', path: MY_DRIVE + '/Time' }]),
  [PROJECTS]: page(PROJECTS, [], true),
};

function port(overrides: Partial<DriveBrowserPort> = {}): DriveBrowserPort {
  return {
    roots: vi.fn(async () => roots),
    list: vi.fn(async value => {
      const found = pages[value];
      if (found === undefined) throw Object.assign(new Error('missing'), { code: 'SHARING_FOLDER_MISSING' });
      return found;
    }),
    ...overrides,
  };
}

function renderPicker(options: { port?: DriveBrowserPort; onSelect?: (path: string) => void; onClose?: () => void } = {}) {
  return render(<DriveFolderPicker open busy={false} port={options.port ?? port()} onClose={options.onClose ?? (() => {})} onSelect={options.onSelect ?? (() => {})} />);
}

describe('drive folder picker', () => {
  it('lists discovered locations and browses one level with a breadcrumb', async () => {
    renderPicker();
    const location = await screen.findByRole('button', { name: /member@example\.test/ });
    fireEvent.click(location);
    fireEvent.click(await screen.findByRole('button', { name: 'My Drive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Projetos' }));
    expect(await screen.findByText(/kanban-hub.yaml is already here/)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toContain('Projetos');
  });

  it('selects the current folder', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    fireEvent.click(await screen.findByRole('button', { name: /member@example\.test/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'My Drive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Projetos' }));
    await screen.findByText(/kanban-hub.yaml is already here/);
    fireEvent.click(screen.getByRole('button', { name: 'Select this folder' }));
    expect(onSelect).toHaveBeenCalledWith(PROJECTS);
  });

  it('filters the current level without changing the folder', async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: /member@example\.test/ }));
    fireEvent.change(await screen.findByLabelText('Filter folders'), { target: { value: 'Unrec' } });
    expect(screen.queryByRole('button', { name: 'My Drive' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unrecognized' })).toBeTruthy();
  });

  it('offers the native picker as an alternative', async () => {
    const onSelect = vi.fn();
    renderPicker({ port: port({ pickNative: async () => '/Users/member/Other/Team' }), onSelect });
    fireEvent.click(await screen.findByRole('button', { name: 'Use another folder…' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/Users/member/Other/Team'));
  });

  it('explains when the application is not detected', async () => {
    renderPicker({ port: port({ roots: async () => ({ state: 'app-missing', locations: [] }) }) });
    expect(await screen.findByText(/Google Drive for desktop was not detected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rescan/ })).toBeTruthy();
  });

  it('names a refused folder', async () => {
    renderPicker({
      port: port({ list: async () => { throw Object.assign(new Error('denied'), { code: 'SHARING_DRIVE_PERMISSION_DENIED', message: 'The operating system denied access to that Google Drive folder.' }); } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /member@example\.test/ }));
    expect(await screen.findByText('SHARING_DRIVE_PERMISSION_DENIED')).toBeTruthy();
  });

  it('keeps focus inside the dialog after navigation so Escape still closes it', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    fireEvent.click(await screen.findByRole('button', { name: /member@example\.test/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'My Drive' }));
    await screen.findByRole('button', { name: 'Projetos' });
    const browser = screen.getByRole('region', { name: 'Folders' });
    expect(document.activeElement).toBe(browser);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clears the selection when a location cannot be opened', async () => {
    renderPicker({
      port: port({
        roots: async () => ({ state: 'ready', locations: [{ id: ROOT, rootPath: ROOT, kind: 'account', status: 'unavailable', reason: 'The Google Drive location is not mounted.' }] }),
      }),
    });
    const location = await screen.findByTitle('/Users/member/Drive');
    fireEvent.click(location);
    expect(await screen.findByText('SHARING_DRIVE_MOUNT_UNAVAILABLE')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Select this folder' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('folder path helpers', () => {
  it('computes containment and breadcrumbs for a location', () => {
    expect(isInsideLocation(ROOT, PROJECTS)).toBe(true);
    expect(isInsideLocation(ROOT, '/Users/member/Drive Two')).toBe(false);
    expect(breadcrumb(ROOT, PROJECTS).map(segment => segment.name)).toEqual(['Drive', 'My Drive', 'Projetos']);
  });
});
