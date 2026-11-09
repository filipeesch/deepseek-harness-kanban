import { describe, expect, it } from 'vitest';
import { KanbanError } from '../../src/shared/errors.js';
import { matchesTeamGlob, normalizeTeamGlob } from '../../src/host/team-files/pattern.js';

function codeOf(run: () => unknown): string {
  try { run(); } catch (error) { return error instanceof KanbanError ? error.code : 'NOT_A_KANBAN_ERROR'; }
  return 'NO_ERROR';
}

describe('team file path patterns', () => {
  it('matches a path segment and a cross-directory pattern', () => {
    expect(matchesTeamGlob('*.md', 'notes.md')).toBe(true);
    expect(matchesTeamGlob('*.md', 'docs/notes.md')).toBe(false);
    expect(matchesTeamGlob('docs/**/*.md', 'docs/a/b/notes.md')).toBe(true);
    expect(matchesTeamGlob('docs/**/*.md', 'docs/notes.md')).toBe(true);
    expect(matchesTeamGlob('docs/**/*.md', 'other/notes.md')).toBe(false);
    expect(matchesTeamGlob('docs/**', 'docs/a/b.md')).toBe(true);
  });

  it('treats ? as one character and every other marker literally', () => {
    expect(matchesTeamGlob('notes-?.md', 'notes-a.md')).toBe(true);
    expect(matchesTeamGlob('notes-?.md', 'notes-ab.md')).toBe(false);
    expect(matchesTeamGlob('a.b.md', 'axb.md')).toBe(false);
    expect(matchesTeamGlob('a+b.md', 'a+b.md')).toBe(true);
  });

  it('supports character classes, ranges, and negation', () => {
    expect(matchesTeamGlob('[ab].md', 'a.md')).toBe(true);
    expect(matchesTeamGlob('[ab].md', 'b.md')).toBe(true);
    expect(matchesTeamGlob('[ab].md', 'c.md')).toBe(false);
    expect(matchesTeamGlob('v[0-9].md', 'v7.md')).toBe(true);
    expect(matchesTeamGlob('v[0-9].md', 'vx.md')).toBe(false);
    expect(matchesTeamGlob('[!ab].md', 'c.md')).toBe(true);
    expect(matchesTeamGlob('[!ab].md', 'a.md')).toBe(false);
    expect(matchesTeamGlob('[^ab].md', 'c.md')).toBe(true);
    expect(matchesTeamGlob('docs/[a-z]*/[0-9].md', 'docs/guides/1.md')).toBe(true);
  });

  it('never lets a class match a path separator', () => {
    expect(matchesTeamGlob('a[!x]b.md', 'a/b.md')).toBe(false);
    expect(matchesTeamGlob('a[abc]b.md', 'a/b.md')).toBe(false);
  });

  it('reports a malformed class as a typed pattern failure', () => {
    expect(codeOf(() => matchesTeamGlob('[z-a].md', 'z.md'))).toBe('TEAM_FILE_PATH_INVALID');
  });

  it('treats an unclosed or empty bracket as a literal', () => {
    expect(matchesTeamGlob('[ab.md', '[ab.md')).toBe(true);
    expect(matchesTeamGlob('a[].md', 'a[].md')).toBe(true);
  });

  it('refuses an empty pattern, a backslash, and an absolute pattern', () => {
    expect(codeOf(() => normalizeTeamGlob('   '))).toBe('INVALID_INPUT');
    expect(codeOf(() => normalizeTeamGlob('docs\\*.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(codeOf(() => normalizeTeamGlob('/docs/*.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(normalizeTeamGlob(' docs/**/*.md ')).toBe('docs/**/*.md');
  });
});
