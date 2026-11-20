import { z } from 'zod';
import type { Problem } from '../../shared/types.js';
import { KanbanError } from '../../shared/errors.js';
import { isDomainId } from '../validation.js';
import { PROJECT_KEY_PATTERN } from '../project-key.js';

/**
 * The transfer format one export writes and one import reads.
 *
 * A document carries what a board owns that is meaningful outside the
 * installation: its name, its authored workflow, its recorded default-preset
 * choice, its project scope, and its local stage identities. Tasks, notes,
 * conversations, worktrees, project registrations, schedules, relations, and Hub
 * settings are absent, so an import never arrives pointing at something the
 * destination installation does not hold.
 */

/** The marker that proves a payload is this format rather than arbitrary JSON. */
export const TRANSFER_FORMAT = 'dsh-kanban-workflows';
/** The format version this installation writes, and the newest it reads. */
export const TRANSFER_VERSION = 1;
/** The largest compressed document the import surface accepts. */
export const TRANSFER_MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
/** The largest payload a compressed document may expand to, which bounds a decompression bomb. */
export const TRANSFER_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

/** One board as the document carries it. */
export interface TransferBoard {
  readonly name: string;
  readonly workflowYaml: string;
  /** Null means the board records no choice and the destination decides. */
  readonly presetMode: 'operator' | 'host' | null;
  /** Null means the board allows every project; an empty list closes it to creation. */
  readonly projectKeys: readonly string[] | null;
  /** The stable identity of each authored stage, keyed by its authored identifier. */
  readonly stageIdentities: Readonly<Record<string, string>> | null;
}

/** One whole transfer document. */
export interface TransferDocument {
  readonly format: typeof TRANSFER_FORMAT;
  readonly version: number;
  /** The Hub the document came from; reported for context and never used to decide anything. */
  readonly origin: { readonly hubName: string };
  readonly boards: readonly TransferBoard[];
}

/** One board as an exporter names it, before the document normalizes the entry. */
export interface TransferBoardInput {
  readonly name: string;
  readonly workflowYaml: string;
  readonly presetMode?: 'operator' | 'host';
  readonly projectKeys?: readonly string[];
  readonly stageIdentities?: Readonly<Record<string, string>>;
}

const identifier = z.string().refine(isDomainId, 'Expected a safe identifier.');
const boardName = z.string().refine(value => value.trim().length > 0, 'A board name must be nonempty.');
const projectKey = z.string().regex(PROJECT_KEY_PATTERN, 'A project key must be a lowercase slug.');

/** The shape one parsed document carries, before its cross-entry rules run. */
const documentShape = z.strictObject({
  format: z.string(),
  version: z.number(),
  origin: z.strictObject({ hubName: z.string() }),
  boards: z.array(z.strictObject({
    name: boardName,
    workflowYaml: z.string().refine(value => value.trim().length > 0, 'A workflow document must be nonempty text.'),
    presetMode: z.enum(['operator', 'host']).nullable(),
    projectKeys: z.array(projectKey).nullable(),
    stageIdentities: z.record(identifier, identifier).nullable(),
  })),
});

function refuse(code: 'TRANSFER_INVALID_DOCUMENT' | 'TRANSFER_UNSUPPORTED_VERSION' | 'TRANSFER_EMPTY', message: string, details?: Record<string, unknown>): never {
  throw new KanbanError(code, message, details);
}

/**
 * Read a decoded payload as a transfer document.
 *
 * The version is checked before the shape, so a document written by a newer
 * installation reports that fact instead of a list of unknown-field problems.
 * Every refusal names one condition, because the person choosing the file can
 * only act on one at a time.
 */
export function parseTransferDocument(payload: unknown): TransferDocument {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) refuse('TRANSFER_INVALID_DOCUMENT', 'The document is not a Kanban workflow export.');
  const record = payload as Record<string, unknown>;
  if (record.format !== TRANSFER_FORMAT) refuse('TRANSFER_INVALID_DOCUMENT', 'The document is not a Kanban workflow export.');
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    refuse('TRANSFER_INVALID_DOCUMENT', 'The document states no readable format version.');
  }
  if (record.version > TRANSFER_VERSION) {
    refuse('TRANSFER_UNSUPPORTED_VERSION', 'This document was written by a newer version of the plugin (format ' + String(record.version) + '). This installation reads format ' + String(TRANSFER_VERSION) + '; update the plugin to import it.', { version: record.version, supported: TRANSFER_VERSION });
  }
  const parsed = documentShape.safeParse(payload);
  if (!parsed.success) {
    refuse('TRANSFER_INVALID_DOCUMENT', 'The document is not valid: ' + parsed.error.issues.slice(0, 3).map(issue => issue.path.join('.') + ' ' + issue.message).join('; '));
  }
  if (parsed.data.boards.length === 0) refuse('TRANSFER_EMPTY', 'The document carries no workflow to import.');
  const folded = parsed.data.boards.map(board => board.name.trim().toLocaleLowerCase());
  if (new Set(folded).size !== folded.length) {
    refuse('TRANSFER_INVALID_DOCUMENT', 'The document names the same board twice; board names must be unique within a Hub.');
  }
  return {
    format: TRANSFER_FORMAT,
    version: parsed.data.version,
    origin: { hubName: parsed.data.origin.hubName },
    boards: parsed.data.boards.map(board => ({
      name: board.name,
      workflowYaml: board.workflowYaml,
      presetMode: board.presetMode,
      projectKeys: board.projectKeys === null ? null : [...board.projectKeys],
      stageIdentities: board.stageIdentities === null ? null : { ...board.stageIdentities },
    })),
  };
}

/** One board entry built from the board it is exported from. */
export function transferBoard(input: TransferBoardInput): TransferBoard {
  const identities = input.stageIdentities === undefined
    ? []
    : Object.entries(input.stageIdentities).sort(([left], [right]) => left.localeCompare(right));
  return {
    name: input.name,
    workflowYaml: input.workflowYaml,
    presetMode: input.presetMode ?? null,
    projectKeys: input.projectKeys === undefined ? null : [...input.projectKeys],
    stageIdentities: identities.length === 0 ? null : Object.fromEntries(identities),
  };
}

/**
 * The document as the exact text an export stores.
 *
 * The key order of every object is fixed here rather than inherited from the
 * insertion order of a map, and no clock or path is written, so exporting the
 * same Hub state twice produces the same bytes and two exports can be compared.
 */
export function serializeTransferDocument(document: TransferDocument): string {
  return JSON.stringify({
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    origin: { hubName: document.origin.hubName },
    boards: document.boards.map(board => ({
      name: board.name,
      workflowYaml: board.workflowYaml,
      presetMode: board.presetMode,
      projectKeys: board.projectKeys === null ? null : [...board.projectKeys],
      stageIdentities: board.stageIdentities === null ? null : Object.fromEntries(
        Object.entries(board.stageIdentities).sort(([left], [right]) => left.localeCompare(right)),
      ),
    })),
  });
}

/** One refusal as the interface reports it. */
export function transferProblem(error: unknown): Problem {
  if (error instanceof KanbanError) return { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  return { code: 'TRANSFER_FAILED', message: error instanceof Error ? error.message : String(error) };
}
