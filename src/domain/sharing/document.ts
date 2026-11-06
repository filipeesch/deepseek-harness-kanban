import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { KanbanError } from '../../shared/errors.js';
import { parseWorkflow } from '../workflow.js';

/** The single published artifact: one ordered board list with authored workflow text. */
export interface SharedBoardEntry { key: string; name: string; workflow: string }
export interface SharedHubDocument { version: 1; boards: SharedBoardEntry[] }

/** Stable board keys are file- and URL-safe, and never derived from a mutable local id. */
export const SHARED_BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const boardEntry = z.strictObject({
  key: z.string().refine(value => SHARED_BOARD_KEY_PATTERN.test(value), 'Expected a stable board key.'),
  name: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty board name.'),
  workflow: z.string().refine(value => value.trim().length > 0, 'Expected a nonempty workflow.'),
});

const documentSchema = z.strictObject({
  version: z.literal(1),
  boards: z.array(boardEntry),
});

/** Shape validation for durable records; `parseSharedDocument` adds the workflow semantics. */
export const SharedHubDocumentSchema: z.ZodType<SharedHubDocument> = documentSchema as unknown as z.ZodType<SharedHubDocument>;

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new KanbanError('SHARING_INVALID_DOCUMENT', message, details);
}

function normalizedName(value: string): string { return value.trim().toLocaleLowerCase(); }

/**
 * Parse a published document, normalize board names, and reject anything the
 * Hub could not hold: unsafe keys, duplicate keys, duplicate names, or a board
 * whose workflow text is not a valid workflow.
 */
export function parseSharedDocument(text: string): SharedHubDocument {
  let raw: unknown;
  try { raw = parseYaml(text); }
  catch (error) { invalid('The published configuration is not valid YAML.', { cause: error instanceof Error ? error.message : String(error) }); }
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    invalid('The published configuration is invalid: ' + (issue ? issue.path.join('.') + ' ' + issue.message : 'unknown shape') + '.');
  }
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
    return { key: entry.key, name, workflow: entry.workflow };
  });
  return { version: 1, boards };
}

/** Canonical authored text; the workflow stays a literal block so diffs stay readable. */
export function serializeSharedDocument(document: SharedHubDocument): string {
  return stringifyYaml({ version: document.version, boards: document.boards.map(entry => ({ key: entry.key, name: entry.name, workflow: entry.workflow })) }, { blockQuote: 'literal', lineWidth: 0 });
}

/** Content identity. Formatting and board order changes that preserve meaning keep the token. */
export function sharedDocumentToken(document: SharedHubDocument): string {
  const canonical = JSON.stringify({
    version: document.version,
    boards: document.boards.map(entry => ({ key: entry.key, name: entry.name.trim(), workflow: entry.workflow })),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function sameSharedDocument(left: SharedHubDocument | null, right: SharedHubDocument | null): boolean {
  if (left === null || right === null) return left === right;
  return sharedDocumentToken(left) === sharedDocumentToken(right);
}

export function boardContentKey(entry: { name: string; workflow: string }): string {
  return JSON.stringify([entry.name, entry.workflow]);
}
