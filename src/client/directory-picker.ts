import { KanbanError } from '../shared/errors.js';

/** A directory selection surface; the composition root chooses the native source. */
export interface DirectoryPickerPort {
  pick(): Promise<string | null>;
}

export interface DirectoryPickerSources {
  /** Desktop renderer injected by the host application. */
  desktop?: () => Promise<string | null>;
  /** Host-provided directory picker service. */
  host?: () => Promise<string | null>;
}

/** Prefer the desktop picker; fall back to the host service only when it is absent. */
export function createDirectoryPicker(sources: DirectoryPickerSources): DirectoryPickerPort {
  const source = sources.desktop ?? sources.host;
  return {
    async pick(): Promise<string | null> {
      if (source === undefined) {
        throw new KanbanError('DIRECTORY_PICKER_UNAVAILABLE', 'This host does not provide a folder picker. Enter the path manually.');
      }
      try { return await source(); }
      catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new KanbanError('DIRECTORY_PICKER_FAILED', 'The folder picker could not complete. Enter the path manually.', { cause });
      }
    },
  };
}
