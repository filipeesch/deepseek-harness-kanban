import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { KanbanError } from '../../shared/errors.js';
import { parseWorkflow } from '../workflow.js';
import { PROJECT_KEY_PATTERN, canonicalProjectKeys } from '../project-key.js';

/** The published document file name shared by every storage. */
export const SHARED_DOCUMENT_FILE = 'kanban-hub.yaml';

/** The published format this installation writes. */
export const SHARED_DOCUMENT_VERSION = 2;

/** Every format this installation reads; an older one is normalized to the current shape. */
export const SUPPORTED_DOCUMENT_VERSIONS: readonly number[] = [1, 2];

/**
 * The single published artifact: one ordered board list with authored workflow text
 * and, when the board allows only some projects, the keys it allows.
 */
export interface SharedBoardEntry {
  key: string;
  name: string;
  workflow: string;
  /** Absent means the board allows every project of the hub that receives it; an empty list closes it. */
  projectKeys?: string[];
}
export interface SharedHubDocument { version: typeof SHARED_DOCUMENT_VERSION; boards: SharedBoardEntry[] }

/** Stable board keys are file- and URL-safe, and never derived from a mutable local id. */
export const SHARED_BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const boardEntry = z.strictObject({
  key: z.string().refine(value => SHARED_BOARD_KEY_PATTERN.test(value), 'Expected a stable board key.'),
  name: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty board name.'),
  workflow: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty workflow.'),
  projectKeys: z.array(z.string().refine(value => PROJECT_KEY_PATTERN.test(value), 'Expected a safe project key.')).optional(),
});

const documentSchema = z.strictObject({
  version: z.number().int().positive(),
  boards: z.array(boardEntry),
});

/** Shape validation for durable records; `parseSharedDocument` adds the workflow semantics. */
export const SharedHubDocumentSchema: z.ZodType<SharedHubDocument> = documentSchema as unknown as z.ZodType<SharedHubDocument>;

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new KanbanError('SHARING_INVALID_DOCUMENT', message, details);
}

function normalizedName(value: string): string { return value.trim().toLocaleLowerCase(); }

/** A published key list is a set: it is de-duplicated and ordered, and absent stays absent. */
function normalizedKeys(value: readonly string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : canonicalProjectKeys(value);
}

/**
 * Parse a published document, normalize board names, and reject anything the Hub
 * could not hold: unsafe keys, duplicate keys, duplicate names, or a board whose
 * workflow text is not a valid workflow. A version this installation does not know
 * is refused instead of guessed at, so an outdated plugin never rewrites it.
 */
export function parseSharedDocument(text: string): SharedHubDocument {
  let raw: unknown;
  try { raw = parseYaml(text); }
  catch (error) { invalid('The published configuration is not valid YAML.', { cause: error instanceof Error ? error.message : String(error) }); }
  // The version is the one signal a future document still shares with this one, so it
  // is read before the shape: a document from a newer plugin may carry fields this
  // version does not know, and it must fail as "update the plugin", not as "invalid".
  const declaredVersion = typeof raw === 'object' && raw !== null && 'version' in raw ? (raw as { version?: unknown }).version : undefined;
  if (typeof declaredVersion === 'number' && Number.isInteger(declaredVersion) && declaredVersion > SHARED_DOCUMENT_VERSION) {
    throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { version: declaredVersion, supported: SHARED_DOCUMENT_VERSION });
  }
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    invalid('The published configuration is invalid: ' + (issue ? issue.path.join('.') + ' ' + issue.message : 'unknown shape') + '.');
  }
  const version = parsed.data.version;
  if (!SUPPORTED_DOCUMENT_VERSIONS.includes(version)) invalid('The published configuration states an unsupported format version: ' + version + '.', { version });
  const keys = new Set<string>();
  const names = new Set<string>();
  const boards = parsed.data.boards.map((entry, index): SharedBoardEntry => {
    const name = entry.name.trim();
    if (keys.has(entry.key)) invalid('The published configuration repeats a board key: ' + entry.key + '.', { key: entry.key });
    keys.add(entry.key);
    if (names.has(normalizedName(name))) invalid('The published configuration repeats a board name: ' + name + '.', { board: name });
    names.add(normalizedName(name));
    try { parseWorkflow(entry.workflow); }
    catch (error) { invalid('Board ' + name + ' has an invalid workflow: ' + (error instanceof Error ? error.message : String(error)) + '.', { board: name, index }); }
    // Format 1 predates project scopes, so any key it carried is not part of that format.
    const projectKeys = version === 1 ? undefined : normalizedKeys(entry.projectKeys);
    return { key: entry.key, name, workflow: entry.workflow, ...(projectKeys === undefined ? {} : { projectKeys }) };
  });
  return { version: SHARED_DOCUMENT_VERSION, boards };
}

/** Canonical authored text; the workflow stays a literal block so diffs stay readable. */
export function serializeSharedDocument(document: SharedHubDocument): string {
  return stringifyYaml({
    version: SHARED_DOCUMENT_VERSION,
    boards: document.boards.map(entry => ({ key: entry.key, name: entry.name, workflow: entry.workflow, ...(entry.projectKeys === undefined ? {} : { projectKeys: entry.projectKeys }) })),
  }, { blockQuote: 'literal', lineWidth: 0 });
}

/** Content identity. Formatting and board order changes that preserve meaning keep the token. */
export function sharedDocumentToken(document: SharedHubDocument): string {
  const canonical = JSON.stringify({
    version: SHARED_DOCUMENT_VERSION,
    boards: document.boards.map(entry => ({
      key: entry.key,
      name: entry.name.trim(),
      workflow: entry.workflow,
      projectKeys: entry.projectKeys === undefined ? null : canonicalProjectKeys(entry.projectKeys),
    })),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function sameSharedDocument(left: SharedHubDocument | null, right: SharedHubDocument | null): boolean {
  if (left === null || right === null) return left === right;
  return sharedDocumentToken(left) === sharedDocumentToken(right);
}

/** Two board entries have the same content when name, workflow, and project scope match. */
export function boardContentKey(entry: { name: string; workflow: string; projectKeys?: readonly string[] }): string {
  return JSON.stringify([entry.name, entry.workflow, entry.projectKeys === undefined ? null : canonicalProjectKeys(entry.projectKeys)]);
}
