import React, { useRef } from 'react';
import type { SharingStorage } from '../../../shared/types.js';
import { SHARING_STORAGES } from '../../../shared/types.js';
import { CloudIcon, DriveIcon, FolderIcon, GitBranchIcon, type IconProps } from '../../icons.js';

export interface StorageMeta {
  label: string;
  description: string;
  Icon: (props: IconProps) => React.JSX.Element;
}

/** One card per storage; the icon and description live beside the id, not in the panel. */
export const STORAGE_META: Record<SharingStorage, StorageMeta> = {
  git: { label: 'Git repository', description: 'Share this Hub’s boards and workflows through a Git repository.', Icon: GitBranchIcon },
  'google-drive': { label: 'Google Drive Cloud', description: 'Authorize a Google account and share through the Drive API.', Icon: CloudIcon },
  'google-drive-local': { label: 'Google Drive Local', description: 'Use a folder from the Google Drive app installed here.', Icon: DriveIcon },
  'local-folder': { label: 'Local folder', description: 'Share through any folder a desktop client syncs.', Icon: FolderIcon },
};

/**
 * The storage chooser as a radio group of cards. While a Hub is bound every
 * card is disabled: changing the storage requires Disconnect, and the selected
 * card is the bound one.
 */
export function StorageCards({ value, onChange, locked, busy }: { value: SharingStorage; onChange: (value: SharingStorage) => void; locked: boolean; busy: boolean }) {
  const disabled = locked || busy;
  const groupRef = useRef<HTMLDivElement>(null);

  function focusAndSelect(next: SharingStorage): void {
    if (disabled) return;
    onChange(next);
    groupRef.current?.querySelector<HTMLElement>('[data-storage="' + next + '"]')?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (disabled) return;
    const focused = (event.currentTarget as HTMLElement).dataset.storage as SharingStorage | undefined;
    const index = SHARING_STORAGES.indexOf(focused ?? value);
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % SHARING_STORAGES.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + SHARING_STORAGES.length - 1) % SHARING_STORAGES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SHARING_STORAGES.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const target = SHARING_STORAGES[next];
    if (target !== undefined) focusAndSelect(target);
  }

  return <div className="kb-storage-cards" role="radiogroup" aria-label="Team storage" ref={groupRef} aria-disabled={disabled}>
    {SHARING_STORAGES.map(storage => {
      const meta = STORAGE_META[storage];
      const Icon = meta.Icon;
      const selected = storage === value;
      return <button
        key={storage}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={meta.label}
        aria-describedby={'storage-description-' + storage}
        data-storage={storage}
        className={'kb-storage-card' + (selected ? ' is-selected' : '')}
        tabIndex={selected ? 0 : -1}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onClick={() => { if (!disabled) onChange(storage); }}
      >
        <span className="kb-storage-card-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="kb-storage-card-text">
          <span className="kb-storage-card-name">{meta.label}</span>
          <span className="kb-storage-card-description" id={'storage-description-' + storage}>{meta.description}</span>
        </span>
      </button>;
    })}
  </div>;
}
