import { invariant } from '../shared/errors.js';
import type { Note } from '../shared/types.js';
import { assertId } from './validation.js';

/** Tags kept on one note; the UI and the tools use the same limits. */
export const MAX_NOTE_TAGS = 4;
/** Maximum stored length of a single normalized tag. */
export const MAX_NOTE_TAG_LENGTH = 15;

/** The fields a note write may carry. */
export interface NotePatch { content?: string; tags?: string[] }
/** A note write. Creation requires content; an update requires content or tags. */
export interface NoteInput extends NotePatch { id?: string }

/** A validated write, split so callers never re-check content or tags. */
export type NoteWrite =
  | { kind: 'create'; content: string; tags?: string[] }
  | { kind: 'update'; id: string; content?: string; tags?: string[] };

export function assertNoteTags(value: unknown): void {
  invariant(value === undefined || (Array.isArray(value) && value.every(tag => typeof tag === 'string')),
    'INVALID_INPUT', 'Note tags must be text values.');
}

/** Trim, lowercase, truncate, deduplicate, discard empties, and keep at most four. */
export function normalizeNoteTags(tags: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const tag of tags) {
    const cleaned = tag.trim().toLowerCase().slice(0, MAX_NOTE_TAG_LENGTH);
    if (cleaned.length > 0) normalized.add(cleaned);
  }
  return [...normalized].slice(0, MAX_NOTE_TAGS);
}

/** Normalized tags for comparison and display; stored legacy values are not rewritten. */
export function noteTagsOf(tags: readonly string[] | undefined): string[] {
  return normalizeNoteTags(tags ?? []);
}

/** Replace a note's tags, removing the property when nothing remains. */
export function applyNoteTags(note: Note, tags: readonly string[]): void {
  const normalized = normalizeNoteTags(tags);
  if (normalized.length === 0) delete note.tags;
  else note.tags = normalized;
}

function noteText(value: string): string {
  invariant(value.trim().length > 0, 'INVALID_INPUT', 'Note content must be nonempty text.');
  return value;
}

/** The one write rule shared by the Hub operations and the legacy board store. */
export function validateNoteWrite(input: NoteInput): NoteWrite {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT', 'Note input must be a mapping.');
  if (input.id !== undefined) assertId(input.id, 'Note ID');
  assertNoteTags(input.tags);
  if (input.id === undefined) {
    invariant(input.content !== undefined, 'INVALID_INPUT', 'A new note requires content.');
    return { kind: 'create', content: noteText(input.content), tags: input.tags };
  }
  const content = input.content === undefined ? undefined : noteText(input.content);
  invariant(content !== undefined || input.tags !== undefined, 'INVALID_INPUT', 'Provide note content or tags.');
  return { kind: 'update', id: input.id, content, tags: input.tags };
}
