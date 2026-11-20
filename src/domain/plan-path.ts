/**
 * The plan-file path rule. A plan lives at plans/<segment>/<file>.md inside the
 * conversation's workspace, and this module owns the one rule that derives the
 * segment and the one rule that validates the file name, so every caller agrees
 * on the directory without re-deriving it.
 *
 * It is deliberately separate from the project key: a project key substitutes a
 * fixed value for an empty name because a Hub needs some key, while a plan
 * segment refuses an empty result, because an invented directory would hide the
 * caller's mistake instead of reporting it.
 * @module domain/plan-path
 */
import { invariant } from '../shared/errors.js';

/** The directory plans live under, relative to the conversation workspace. */
export const PLAN_DIRECTORY = 'plans';

/** Maximum length of one plan directory segment, so a long card title stays a usable path part. */
export const PLAN_SEGMENT_MAX_LENGTH = 64;

/** The extension every plan file carries; nothing else may be written by the plan tools. */
export const PLAN_FILE_EXTENSION = '.md';

/** One literal replacement a plan patch applies. */
export interface PlanEdit { readonly old: string; readonly new: string }

/** Characters a plan segment keeps; every other run becomes one hyphen. */
const SEGMENT_SEPARATORS = /[^a-z0-9]+/g;

/** A leading or trailing run of hyphens, which a slug never keeps. */
const EDGE_HYPHENS = /^-+|-+$/g;

/** Separators and parent segments: a plan file name is a bare name, never a path. */
const PATH_SEPARATORS = ['/', String.fromCharCode(92)];
const PARENT_SEGMENTS = new Set(['.', '..']);

/** Whether a name carries a control character, which no plan path may contain. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

/**
 * The directory segment a project name suggests: lowercase, hyphen-separated,
 * bounded, with no leading or trailing hyphen.
 * @param name - the card title or the project name the caller supplied.
 * @returns the segment, or undefined when the name has no usable character.
 */
export function planSegment(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(SEGMENT_SEPARATORS, '-')
    .replace(EDGE_HYPHENS, '')
    .slice(0, PLAN_SEGMENT_MAX_LENGTH)
    // The length bound can expose a trailing hyphen the earlier trim removed.
    .replace(EDGE_HYPHENS, '');
  return slug.length > 0 ? slug : undefined;
}

/**
 * Validate one plan file name: a bare name, never a path.
 * @param value - the caller-supplied file name.
 * @returns the trimmed name, unchanged otherwise.
 * @throws KanbanError INVALID_INPUT for an empty name and INVALID_PLAN_FILE for
 *   any name that is not a bare Markdown file name.
 */
export function planFileName(value: string): string {
  const name = value.trim();
  invariant(name.length > 0, 'INVALID_INPUT', 'Provide a plan file name.');
  invariant(
    !PATH_SEPARATORS.some(separator => name.includes(separator))
      && !PARENT_SEGMENTS.has(name)
      && !hasControlCharacter(name),
    'INVALID_PLAN_FILE',
    'A plan file name is a bare name: it cannot contain a path separator, a parent segment, or a control character.',
  );
  invariant(
    name.toLowerCase().endsWith(PLAN_FILE_EXTENSION),
    'INVALID_PLAN_FILE',
    'A plan file must end in ' + PLAN_FILE_EXTENSION + '.',
  );
  return name;
}

/**
 * The workspace-relative path of one plan file.
 * @param segment - an already-normalized segment.
 * @param fileName - an already-validated file name.
 * @returns the relative path, with forward slashes on every platform.
 */
export function planRelativePath(segment: string, fileName: string): string {
  return PLAN_DIRECTORY + '/' + segment + '/' + fileName;
}

/**
 * Apply every literal replacement in order and refuse the whole call when any of
 * them cannot be applied unambiguously. All-or-nothing is the contract: the
 * caller gets either the complete patch or an untouched file.
 * @param text - the file's current content.
 * @param edits - the replacements, in the order the caller wrote them.
 * @returns the patched content.
 * @throws KanbanError INVALID_INPUT for an empty or no-op search text, and
 *   PLAN_PATCH_MISS or PLAN_PATCH_AMBIGUOUS when a search text does not occur
 *   exactly once.
 */
export function applyPlanEdits(text: string, edits: readonly PlanEdit[]): string {
  let result = text;
  for (const [index, edit] of edits.entries()) {
    const prefix = 'Replacement ' + (index + 1) + ' ';
    invariant(edit.old.length > 0, 'INVALID_INPUT', prefix + 'has an empty search text: use write_plan to rewrite the whole file.');
    invariant(edit.old !== edit.new, 'INVALID_INPUT', prefix + 'leaves its search text unchanged.');
    const first = result.indexOf(edit.old);
    invariant(first !== -1, 'PLAN_PATCH_MISS', prefix + 'matched no text in the plan. Read the file again and search for text it contains.');
    invariant(result.indexOf(edit.old, first + 1) === -1, 'PLAN_PATCH_AMBIGUOUS', prefix + 'matched more than once. Include surrounding context so the search text is unique.');
    result = result.slice(0, first) + edit.new + result.slice(first + edit.old.length);
  }
  return result;
}
