import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DriveBrowseView, DriveDiscoveryView, DriveFolderEntry, DriveLocationView, Problem } from '../../../shared/types.js';
import { ArrowLeftIcon, ChevronRightIcon, DriveIcon, FolderIcon, ReopenIcon, SearchIcon } from '../../icons.js';
import { asProblem, ErrorNotice, Modal } from '../../ui.js';

/** The discovery operations the picker needs; the panel adapts the client API to it. */
export interface DriveBrowserPort {
  roots(refresh?: boolean): Promise<DriveDiscoveryView>;
  list(path: string): Promise<DriveBrowseView>;
  pickNative?(): Promise<string | null>;
}

export interface DriveFolderPickerProps {
  open: boolean;
  busy: boolean;
  port: DriveBrowserPort;
  /** The folder to open when the picker starts, usually the bound one. */
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

function separatorOf(value: string): string { return value.includes('\\') ? '\\' : '/'; }

/** Whether a path is the root itself or lies inside it, ignoring letter case. */
export function isInsideLocation(root: string, value: string): boolean {
  const normalize = (input: string): string => {
    const trimmed = input.length > 1 && /[\\/]$/.test(input) ? input.slice(0, -1) : input;
    return trimmed.toLocaleLowerCase();
  };
  const base = normalize(root);
  const candidate = normalize(value);
  if (candidate === base) return true;
  return candidate.startsWith(base + separatorOf(root)) || candidate.startsWith(base + '/');
}

/** Breadcrumb segments from a location root to the current folder. */
export function breadcrumb(root: string, current: string): Array<{ name: string; path: string }> {
  const separator = separatorOf(root);
  const relative = current.slice(root.length).replace(/^[\\/]+/, '');
  const parts = relative.length === 0 ? [] : relative.split(/[\\/]/).filter(Boolean);
  const segments: Array<{ name: string; path: string }> = [{ name: root.split(/[\\/]/).filter(Boolean).pop() ?? root, path: root }];
  let path = root;
  for (const part of parts) {
    path = path + separator + part;
    segments.push({ name: part, path });
  }
  return segments;
}

interface FolderSection { id: string; label?: string; entries: DriveFolderEntry[] }

/** Group the entries by their recognized Drive structure, keeping the literal order. */
function sectionsOf(entries: DriveFolderEntry[]): FolderSection[] {
  const sections: FolderSection[] = [];
  for (const entry of entries) {
    const id = entry.group?.id ?? 'folders';
    let section = sections.find(value => value.id === id);
    if (section === undefined) {
      section = { id, ...(entry.group === undefined ? {} : { label: entry.group.label }), entries: [] };
      sections.push(section);
    }
    section.entries.push(entry);
  }
  return sections;
}

function locationLabel(location: DriveLocationView): string {
  return location.account ?? location.driveName ?? 'Google Drive';
}

/**
 * The folder browser over the discovered Drive locations: locations on the
 * left, a breadcrumb and one folder level on the right, and the native picker
 * always one click away.
 */
export function DriveFolderPicker({ open, busy, port, initialPath, onClose, onSelect }: DriveFolderPickerProps) {
  const [roots, setRoots] = useState<DriveDiscoveryView | null>(null);
  const [page, setPage] = useState<DriveBrowseView | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const browserRef = useRef<HTMLElement>(null);

  const loadRoots = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const view = await port.roots(refresh);
      setRoots(view);
      return view;
    } catch (failure) {
      setError(asProblem(failure));
      return null;
    } finally {
      setLoading(false);
    }
  }, [port]);

  const focusBrowser = useCallback(() => {
    // Navigation replaces the focused row; keep focus inside the dialog so
    // Escape and the focus trap keep working.
    browserRef.current?.focus();
  }, []);

  const openPath = useCallback(async (value: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      setPage(await port.list(value));
      setFilter('');
      return true;
    } catch (failure) {
      setError(asProblem(failure));
      return false;
    } finally {
      setLoading(false);
      focusBrowser();
    }
  }, [port, focusBrowser]);

  const openLocation = useCallback(async (location: DriveLocationView) => {
    setOpenedId(location.id);
    if (location.status === 'unavailable') {
      setPage(null);
      setOpenedId(null);
      setError({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE', message: location.reason ?? 'That Google Drive location is not available.' });
      focusBrowser();
      return;
    }
    const opened = await openPath(location.rootPath);
    // A refused location must not leave the previous location selectable.
    if (!opened) { setPage(null); setOpenedId(null); }
  }, [openPath, focusBrowser]);

  useEffect(() => { if (open && page !== null) focusBrowser(); }, [open, page?.path]);

  useEffect(() => {
    if (!open) return;
    setPage(null); setFilter(''); setError(null); setOpenedId(null);
    void loadRoots(false);
  }, [open, loadRoots]);

  // Open the bound folder's location once the discovered list arrives.
  useEffect(() => {
    if (!open || roots === null || page !== null || openedId !== null || initialPath === undefined) return;
    const location = roots.locations.find(value => isInsideLocation(value.rootPath, initialPath));
    if (location) void openLocation(location);
  }, [open, roots, page, openedId, initialPath, openLocation]);

  const rootPath = useMemo(() => {
    if (page === null) return null;
    return roots?.locations.find(value => value.id === page.rootId)?.rootPath ?? page.rootId;
  }, [page, roots]);

  const crumbs = page === null || rootPath === null ? [] : breadcrumb(rootPath, page.path);
  const visible = useMemo(() => {
    if (page === null) return [];
    const needle = filter.trim().toLocaleLowerCase();
    return sectionsOf(needle.length === 0 ? page.entries : page.entries.filter(entry => entry.name.toLocaleLowerCase().includes(needle)));
  }, [page, filter]);

  async function pickNative(): Promise<void> {
    if (port.pickNative === undefined) return;
    try {
      const picked = await port.pickNative();
      if (picked) onSelect(picked);
    } catch (failure) { setError(asProblem(failure)); }
  }

  const unavailableReason = roots === null || roots.locations.length > 0
    ? null
    : roots.state === 'app-missing'
      ? 'Google Drive for desktop was not detected on this computer. Install and open the app, then rescan.'
      : roots.state === 'unsupported'
        ? 'Google Drive for desktop is not available on this platform.'
        : roots.state === 'failed'
          ? roots.reason?.message ?? 'The Google Drive settings could not be read.'
          : 'No Google Drive account is mounted. Sign in to Drive for desktop, then rescan.';

  return <Modal title="Choose a Google Drive folder" onClose={onClose} busy={busy} size="wide" initialFocus="cancel">
    <div className="kb-picker">
      <aside className="kb-picker-locations" aria-label="Google Drive locations">
        <div className="kb-picker-locations-header">
          <span>Locations</span>
          <button type="button" className="kb-button kb-picker-rescan" disabled={loading || busy} onClick={() => void loadRoots(true)}>
            <ReopenIcon size={14} /> {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
        {roots === null && loading && <p className="kb-hint">Looking for Google Drive on this computer…</p>}
        {roots !== null && roots.locations.length === 0 && <p className="kb-hint" role="status">{unavailableReason}</p>}
        {roots?.sources?.some(source => !source.ok) && <p className="kb-hint" role="status">Some Google Drive settings could not be read. Rescan may help.</p>}
        <ul className="kb-picker-location-list">
          {(roots?.locations ?? []).map(location => <li key={location.id}>
            <button
              type="button"
              className={'kb-picker-location' + (openedId === location.id ? ' is-selected' : '')}
              aria-pressed={openedId === location.id}
              title={location.rootPath}
              disabled={loading}
              onClick={() => void openLocation(location)}
            >
              <DriveIcon size={18} />
              <span className="kb-picker-location-text">
                <span className="kb-picker-location-name">{locationLabel(location)}</span>
                <span className="kb-picker-location-path">{location.rootPath}</span>
              </span>
              {location.status === 'unavailable' && <span className="kb-badge">Unavailable</span>}
            </button>
          </li>)}
        </ul>
      </aside>
      <section className="kb-picker-browser" aria-label="Folders" ref={browserRef} tabIndex={-1}>
        {page === null
          ? <p className="kb-hint">Choose a Google Drive location to browse its folders.</p>
          : <>
            <div className="kb-picker-toolbar">
              <button type="button" className="kb-button kb-icon-button" aria-label="Back" disabled={page.parent === null || loading} onClick={() => { if (page.parent !== null) void openPath(page.parent); }}>
                <ArrowLeftIcon size={16} />
              </button>
              <nav className="kb-picker-breadcrumb" aria-label="Folder path">
                {crumbs.map((crumb, index) => <React.Fragment key={crumb.path}>
                  {index > 0 && <ChevronRightIcon size={12} className="kb-picker-chevron" />}
                  <button type="button" className="kb-picker-crumb" disabled={index === crumbs.length - 1 || loading} onClick={() => void openPath(crumb.path)}>{crumb.name}</button>
                </React.Fragment>)}
              </nav>
              <label className="kb-picker-filter">
                <SearchIcon size={14} />
                <input className="kb-input" type="search" aria-label="Filter folders" placeholder="Filter" value={filter} disabled={loading} onChange={event => setFilter(event.target.value)} />
              </label>
            </div>
            <ul className="kb-picker-folders" aria-label="Folders in this location" onKeyDown={event => { if (event.key === 'Backspace' && page.parent !== null && filter.length === 0) { event.preventDefault(); void openPath(page.parent); } }}>
              {visible.length === 0 && <li className="kb-hint">{filter.trim().length > 0 ? 'No folders match this filter.' : 'This folder has no subfolders.'}</li>}
              {visible.map(section => <React.Fragment key={section.id}>
                {section.label !== undefined && <li className="kb-picker-section" role="presentation">{section.label}</li>}
                {section.entries.map(entry => <li key={entry.path}>
                  <button type="button" className="kb-picker-folder" disabled={loading} onClick={() => void openPath(entry.path)}>
                    <FolderIcon size={16} /><span>{entry.name}</span>
                  </button>
                </li>)}
              </React.Fragment>)}
            </ul>
            <p className="kb-hint" role="status">
              {page.truncated && <>Showing the first {page.shown} folders; there are more. </>}
              {page.hasDocument ? 'kanban-hub.yaml is already here; the Hub adopts it.' : 'kanban-hub.yaml will be created here.'}
            </p>
          </>}
        <ErrorNotice problem={error} />
      </section>
    </div>
    <footer className="kb-picker-footer">
      {port.pickNative !== undefined && <button type="button" className="kb-button" disabled={busy} onClick={() => void pickNative()}>Use another folder…</button>}
      <div className="kb-picker-footer-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="kb-button kb-primary" disabled={busy || page === null || loading} onClick={() => { if (page !== null) onSelect(page.path); }}>Select this folder</button>
      </div>
    </footer>
  </Modal>;
}
