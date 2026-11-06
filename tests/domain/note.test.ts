import { describe, expect, it } from 'vitest';
import { applyNoteTags, assertNoteTags, normalizeNoteTags, noteTagsOf } from '../../src/domain/note.js';
import type { Note } from '../../src/shared/types.js';

function note(): Note {
  return { id: 'note', taskId: 'task', content: 'body', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

describe('note tag normalization', () => {
  it('trims and lowercases every value', () => {
    expect(normalizeNoteTags([' Design ', 'ARCHITECTURE'])).toEqual(['design', 'architecture']);
  });

  it('truncates a value to 15 characters', () => {
    expect(normalizeNoteTags(['very-long-tag-name-here'])).toEqual(['very-long-tag-n']);
  });

  it('discards values that are empty after normalization', () => {
    expect(normalizeNoteTags(['design', '  ', ''])).toEqual(['design']);
  });

  it('deduplicates after normalization and keeps first-occurrence order', () => {
    expect(normalizeNoteTags(['design', ' Design ', 'architecture', 'DESIGN'])).toEqual(['design', 'architecture']);
  });

  it('keeps at most four tags', () => {
    expect(normalizeNoteTags(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns no tags when nothing survives normalization', () => {
    expect(normalizeNoteTags([' ', ''])).toEqual([]);
  });

  it('rejects values that are not text but accepts empty strings', () => {
    expect(() => assertNoteTags(['design', 4])).toThrowError(/text values/);
    expect(() => assertNoteTags(undefined)).not.toThrow();
    expect(() => assertNoteTags([' '])).not.toThrow();
  });

  it('normalizes stored tags for comparison without rewriting them', () => {
    expect(noteTagsOf([' Design ', 'very-long-tag-name-here', 'a', 'b', 'c'])).toEqual(['design', 'very-long-tag-n', 'a', 'b']);
    expect(noteTagsOf(undefined)).toEqual([]);
  });

  it('replaces a note tag collection and removes it when empty', () => {
    const value = note();
    applyNoteTags(value, [' Design ', 'TODO']);
    expect(value.tags).toEqual(['design', 'todo']);
    applyNoteTags(value, []);
    expect(value.tags).toBeUndefined();
  });
});
