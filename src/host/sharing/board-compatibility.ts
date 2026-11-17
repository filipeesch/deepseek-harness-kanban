import { KanbanError } from '../../shared/errors.js';
import { decodeBoardLog, type BoardLog, type BoardLogDecode } from '../../domain/journal/log.js';

/**
 * The compatible-writer boundary of one board.
 *
 * A board's log is readable exactly when this installation decodes every event in it,
 * so a field it cannot represent is never silently dropped. The plugin-update state is
 * therefore per board: a board this installation cannot read is neither applied nor
 * published over, and every other board of the Hub keeps synchronizing.
 */

/** The code every unreadable board log reports. */
export const PLUGIN_UPDATE_REQUIRED = 'SHARING_DOCUMENT_VERSION_UNSUPPORTED';

/** The per-board problem a stored log or a failed read states. */
export interface BoardProblem {
  readonly code: string;
  readonly message: string;
}

const NEWER_FORMAT = "This board's log was written by a newer plugin version. Update dsh-kanban to read or publish it.";
const UNKNOWN_CHANGE = "This board's log carries a change dsh-kanban does not know. Update dsh-kanban to read or publish it.";

/** One failed read of a board log. */
export type BoardLogFailure = Exclude<BoardLogDecode, { readonly ok: true }>;

/** The problem a decoded log failure states, or null when it is not a format boundary. */
export function formatProblem(decoded: BoardLogFailure): BoardProblem | null {
  if (decoded.reason === 'unsupported-version') return { code: PLUGIN_UPDATE_REQUIRED, message: NEWER_FORMAT };
  if (decoded.reason === 'unknown-kind') return { code: PLUGIN_UPDATE_REQUIRED, message: UNKNOWN_CHANGE };
  return null;
}

/** Read one stored board log, refusing a format this installation cannot represent. */
export function parseBoardLog(text: string, key: string): BoardLog {
  const decoded = decodeBoardLog(text);
  if (decoded.ok) return decoded.log;
  switch (decoded.reason) {
    case 'unsupported-version': throw new KanbanError(PLUGIN_UPDATE_REQUIRED, NEWER_FORMAT, { key, version: decoded.version });
    case 'unknown-kind': throw new KanbanError(PLUGIN_UPDATE_REQUIRED, UNKNOWN_CHANGE, { key, kind: decoded.kind });
    default: throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The board log is invalid.', { key, message: decoded.message });
  }
}

/** The per-board problem a failed read raises, or null when the failure is not a boundary. */
export function boardProblemOf(error: unknown): BoardProblem | null {
  if (error instanceof KanbanError && error.code === PLUGIN_UPDATE_REQUIRED) return { code: error.code, message: error.message };
  return null;
}

/** Whether one board's problem means this installation must be updated to read it. */
export function needsPluginUpdate(problem: BoardProblem | null | undefined): boolean {
  return problem?.code === PLUGIN_UPDATE_REQUIRED;
}
