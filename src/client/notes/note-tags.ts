import { normalizeNoteTags, noteTagsOf } from '../../domain/note.js';
import type { Note } from '../../shared/types.js';

/** Unique tags across the notes, alphabetically ordered; legacy values are normalized for display. */
export function uniqueTags(notes: readonly Note[]): string[] {
  const values = new Set<string>();
  for (const note of notes) for (const tag of noteTagsOf(note.tags)) values.add(tag);
  return [...values].sort();
}

/** The notes shown for one active tag; a null tag means every note. */
export function filterNotes(notes: readonly Note[], tag: string | null): Note[] {
  return tag === null ? [...notes] : notes.filter(note => noteTagsOf(note.tags).includes(tag));
}

/** Selecting the active tag clears the filter. */
export function toggleTag(active: string | null, tag: string): string | null {
  return active === tag ? null : tag;
}

/** Add one drafted value with the same normalization applied before storage. */
export function addDraftTag(tags: readonly string[], raw: string): string[] {
  if (!raw.trim()) return [...tags];
  return normalizeNoteTags([...tags, raw]);
}
