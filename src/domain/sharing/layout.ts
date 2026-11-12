/**
 * The published layout: one stamp that states the layout format, and one log per
 * board. The stamp carries no board list — the published boards are the logs that
 * exist, and each board's name, project scope, and position live in its own log.
 */

/** The published layout stamp file name, shared by every storage. */
export const SHARED_LAYOUT_FILE = 'kanban-hub.yaml';
/** The directory that holds one log per published board. */
export const SHARED_BOARD_DIRECTORY = 'kanban-boards';
/** The published layout format this installation writes. */
export const SHARED_LAYOUT_VERSION = 4;
/** A stable board key: file-safe, and never derived from a mutable local id. */
export const SHARED_BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The event-log extension, one JSON object per line. */
export const SHARED_BOARD_EXTENSION = '.jsonl';
/** Google Drive Cloud has no directories, so each log is a sibling file. */
export const DRIVE_BOARD_FILE_PREFIX = 'kanban-board-';

/** One read stamp: only the layout version, because the layout carries nothing else. */
export interface LayoutStamp { readonly version: number }

/** The stamp one installation writes. */
export function serializeLayoutStamp(): string {
  return 'version: ' + SHARED_LAYOUT_VERSION + String.fromCharCode(10);
}

/** The layout version a stamp declares. A stamp without one is invalid, never guessed. */
export function readLayoutStamp(text: string): LayoutStamp {
  const match = /^version:\s*(\d+)\s*$/m.exec(text);
  if (match === null) throw invalid('The published layout stamp does not state a format version.');
  const version = Number(match[1]);
  if (!Number.isInteger(version) || version < 1) throw invalid('The published layout stamp states an invalid format version.');
  return { version };
}

function invalid(message: string): Error {
  const error = new Error(message);
  error.name = 'SHARING_INVALID_DOCUMENT';
  return error;
}

/** The storage path of one board's log, relative to the published layout root. */
export function boardLogPath(key: string): string {
  return SHARED_BOARD_DIRECTORY + '/' + key + SHARED_BOARD_EXTENSION;
}

/** The file name one board's log takes in a storage without directories. */
export function driveBoardFileName(key: string): string {
  return DRIVE_BOARD_FILE_PREFIX + key + SHARED_BOARD_EXTENSION;
}
