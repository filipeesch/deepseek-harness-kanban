import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { KanbanError } from '../../shared/errors.js';
import { parseWorkflow } from '../workflow.js';
import { PROJECT_KEY_PATTERN, canonicalProjectKeys } from '../project-key.js';
import { materializeIdentities } from '../journal/materialize.js';

/**
 * The published configuration is a hub manifest plus one log per board.
 *
 * The manifest carries what the board list needs and nothing else: it is read by the
 * navigation, the badges, and every check, so it stays small and is written whole.
 * Each board's authored workflow lives only in that board's own log.
 */

/** The published manifest file name, shared by every storage. */
export const SHARED_MANIFEST_FILE = 'kanban-hub.yaml';
/** The directory that holds one log per published board. */
export const SHARED_BOARD_DIRECTORY = 'kanban-boards';
/** The published format this installation writes. */
export const SHARED_MANIFEST_VERSION = 3;
/** Every format this installation reads. */
export const SUPPORTED_MANIFEST_VERSIONS: readonly number[] = [1, 2, 3];

/** A stable board key, file- and URL-safe, never derived from a mutable local id. */
export const SHARED_BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SharedBoardEntry {
  key: string;
  name: string;
  /** Absent means the board allows every project of the hub; an empty list closes it. */
  projectKeys?: string[];
}

export interface SharedHubManifest {
  version: typeof SHARED_MANIFEST_VERSION;
  boards: SharedBoardEntry[];
}

/** A configuration read from a published file, with any legacy workflow it carried. */
export interface ReadSharedConfiguration {
  manifest: SharedHubManifest;
  /** Workflow text a version 1 or 2 document carried, keyed by board key. */
  legacyWorkflows: Record<string, string>;
  /** The version the file declared before normalization. */
  sourceVersion: number;
}

/** The storage path of one board's log, relative to the published configuration root. */
export function boardLogPath(key: string): string {
  return SHARED_BOARD_DIRECTORY + '/' + key + '.yaml';
}

const boardEntry = z.strictObject({
  key: z.string().refine(value => SHARED_BOARD_KEY_PATTERN.test(value), 'Expected a stable board key.'),
  name: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty board name.'),
  projectKeys: z.array(z.string().refine(value => PROJECT_KEY_PATTERN.test(value), 'Expected a safe project key.')).optional(),
});
/** A version 1 or 2 document also carried the board's whole workflow. */
const legacyBoardEntry = z.strictObject({
  key: boardEntry.shape.key,
  name: boardEntry.shape.name,
  workflow: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty workflow.'),
  projectKeys: boardEntry.shape.projectKeys,
});
const manifestSchema = z.strictObject({ version: z.literal(SHARED_MANIFEST_VERSION), boards: z.array(boardEntry) });
const legacySchema = z.strictObject({ version: z.number().int().positive(), boards: z.array(legacyBoardEntry) });

/** Shape validation for durable records; reading adds the workflow and name semantics. */
export const SharedHubManifestSchema: z.ZodType<SharedHubManifest> = manifestSchema as unknown as z.ZodType<SharedHubManifest>;

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new KanbanError('SHARING_INVALID_DOCUMENT', message, details);
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** A published key list is a set: it is de-duplicated and ordered, and absent stays absent. */
function normalizedKeys(value: readonly string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : canonicalProjectKeys(value);
}

/**
 * Read a published configuration in any supported version.
 *
 * A version 1 or 2 document is normalized to the current shape: its boards become
 * manifest entries, and the workflow each one carried becomes that board's genesis
 * log, with the stable identity of every stage written into the text.
 */
export function readSharedConfiguration(text: string): ReadSharedConfiguration {
  let raw: unknown;
  try { raw = parseYaml(text); }
  catch (error) { invalid('The published configuration is not valid YAML.', { cause: error instanceof Error ? error.message : String(error) }); }
  // The version is the one signal a future document still shares with this one, so it
  // is read before the shape: a document from a newer plugin must fail as "update the
  // plugin", not as "invalid".
  const declared = typeof raw === 'object' && raw !== null && 'version' in raw ? (raw as { version?: unknown }).version : undefined;
  if (typeof declared === 'number' && Number.isInteger(declared) && declared > SHARED_MANIFEST_VERSION) {
    throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.', { version: declared, supported: SHARED_MANIFEST_VERSION });
  }
  if (typeof declared !== 'number' || !SUPPORTED_MANIFEST_VERSIONS.includes(declared)) invalid('The published configuration states an unsupported format version: ' + String(declared) + '.', { version: declared });

  const legacy = legacySchema.safeParse(raw);
  if (legacy.success && legacy.data.version < SHARED_MANIFEST_VERSION) {
    // Format 1 predates project scopes, so any key it carried is not part of that format.
    const entries = normalizeEntries(legacy.data.boards.map(entry => ({
      key: entry.key,
      name: entry.name,
      ...(legacy.data.version === 1 ? {} : { projectKeys: entry.projectKeys }),
    })));
    const legacyWorkflows: Record<string, string> = {};
    for (const entry of legacy.data.boards) {
      parseWorkflowOrFail(entry.workflow, entry.name);
      legacyWorkflows[entry.key] = materializeIdentities(entry.workflow);
    }
    return { manifest: { version: SHARED_MANIFEST_VERSION, boards: entries }, legacyWorkflows, sourceVersion: legacy.data.version };
  }

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    invalid('The published configuration is invalid: ' + (issue ? issue.path.join('.') + ' ' + issue.message : 'unknown shape') + '.');
  }
  return { manifest: { version: SHARED_MANIFEST_VERSION, boards: normalizeEntries(parsed.data.boards) }, legacyWorkflows: {}, sourceVersion: SHARED_MANIFEST_VERSION };
}

function parseWorkflowOrFail(workflow: string, board: string) {
  try { return parseWorkflow(workflow); }
  catch (error) { invalid('Board ' + board + ' has an invalid workflow: ' + (error instanceof Error ? error.message : String(error)) + '.', { board }); }
}

/** Board keys and names are unique, and every workflow is a valid one. */
function normalizeEntries(entries: readonly z.infer<typeof boardEntry>[]): SharedBoardEntry[] {
  const keys = new Set<string>();
  const names = new Set<string>();
  return entries.map(entry => {
    const name = entry.name.trim();
    if (keys.has(entry.key)) invalid('The published configuration repeats a board key: ' + entry.key + '.', { key: entry.key });
    keys.add(entry.key);
    if (names.has(normalizedName(name))) invalid('The published configuration repeats a board name: ' + name + '.', { board: name });
    names.add(normalizedName(name));
    const projectKeys = normalizedKeys(entry.projectKeys);
    return { key: entry.key, name, ...(projectKeys === undefined ? {} : { projectKeys }) };
  });
}

/** Canonical authored text for the manifest. */
export function serializeSharedManifest(manifest: SharedHubManifest): string {
  return stringifyYaml({
    version: SHARED_MANIFEST_VERSION,
    boards: manifest.boards.map(entry => ({ key: entry.key, name: entry.name, ...(entry.projectKeys === undefined ? {} : { projectKeys: entry.projectKeys }) })),
  }, { lineWidth: 0 });
}

/** Content identity. Formatting and order changes that preserve meaning keep the token. */
export function sharedManifestToken(manifest: SharedHubManifest): string {
  const canonical = JSON.stringify({
    version: SHARED_MANIFEST_VERSION,
    boards: manifest.boards.map(entry => ({
      key: entry.key,
      name: entry.name.trim(),
      projectKeys: entry.projectKeys === undefined ? null : canonicalProjectKeys(entry.projectKeys),
    })),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Two manifests carry the same published configuration. */
export function sameSharedManifest(left: SharedHubManifest | null, right: SharedHubManifest | null): boolean {
  if (left === null || right === null) return left === right;
  return sharedManifestToken(left) === sharedManifestToken(right);
}

/** One board entry has the same content when name and project scope match. */
export function boardContentKey(entry: { name: string; projectKeys?: readonly string[] }): string {
  return JSON.stringify([entry.name, entry.projectKeys === undefined ? null : canonicalProjectKeys(entry.projectKeys)]);
}
