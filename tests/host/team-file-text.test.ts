import { describe, expect, it } from 'vitest';
import { KanbanError } from '../../src/shared/errors.js';
import { TEAM_FILE_READ_MAX_BYTES, TEAM_FILE_READ_MAX_LINE_LENGTH } from '../../src/host/team-files/limits.js';
import { renderTeamFile, renderedLineBytes, truncateTeamLine } from '../../src/host/team-files/render.js';
import { assertTextContent, assertTextPath, decodeTeamFileText, isBinaryPath } from '../../src/host/team-files/text.js';

function codeOf(run: () => unknown): string {
  try { run(); } catch (error) { return error instanceof KanbanError ? error.code : 'NOT_A_KANBAN_ERROR'; }
  return 'NO_ERROR';
}

describe('team file text rules', () => {
  it('decodes UTF-8 text with accents and an emoji', () => {
    const bytes = Buffer.from('Ação concluída ✅\n', 'utf8');
    expect(decodeTeamFileText(bytes, 'notes.md')).toBe('Ação concluída ✅\n');
  });

  it('preserves a byte order mark so an edit cannot drop it', () => {
    const bytes = Buffer.from('\uFEFFfirst line\nsecond', 'utf8');
    const decoded = decodeTeamFileText(bytes, 'bom.md');
    expect(decoded.startsWith('\uFEFF')).toBe(true);
    expect(Buffer.from(decoded, 'utf8').equals(bytes)).toBe(true);
  });

  it('refuses a binary payload by NUL byte, invalid UTF-8, and extension', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(codeOf(() => decodeTeamFileText(png, 'diagram.png'))).toBe('TEAM_FILE_BINARY');
    expect(codeOf(() => decodeTeamFileText(Buffer.from([0xff, 0xfe, 0x41]), 'legacy.md'))).toBe('TEAM_FILE_BINARY');
    expect(codeOf(() => assertTextPath('report.pdf'))).toBe('TEAM_FILE_BINARY');
    expect(isBinaryPath('report.PDF')).toBe(true);
    expect(codeOf(() => assertTextPath('notes.md'))).toBe('NO_ERROR');
  });

  it('refuses supplied content a later read would classify as binary', () => {
    expect(codeOf(() => assertTextContent('has \u0000 inside', 'notes.md'))).toBe('TEAM_FILE_BINARY');
    expect(codeOf(() => assertTextContent('lone \uD800 surrogate', 'notes.md'))).toBe('INVALID_INPUT');
    expect(codeOf(() => assertTextContent('plain ✅ text', 'notes.md'))).toBe('NO_ERROR');
  });
});

describe('team file read rendering', () => {
  it('numbers the lines and ignores the empty tail of a trailing newline', () => {
    const rendered = renderTeamFile('alpha\nbeta\n');
    expect(rendered.totalLines).toBe(2);
    expect(rendered.lines).toEqual([{ number: 1, text: 'alpha' }, { number: 2, text: 'beta' }]);
    expect(rendered.truncatedByLines).toBe(false);
    expect(rendered.truncatedByBytes).toBe(false);
  });

  it('returns the requested window and reports the remaining lines', () => {
    const rendered = renderTeamFile('a\nb\nc\nd', { offset: 2, limit: 2 });
    expect(rendered.lines.map(line => line.number)).toEqual([2, 3]);
    expect(rendered.totalLines).toBe(4);
    expect(rendered.truncatedByLines).toBe(true);
  });

  it('truncates one long line at the character bound', () => {
    const text = 'x'.repeat(TEAM_FILE_READ_MAX_LINE_LENGTH + 10);
    expect(truncateTeamLine(text)).toContain('line truncated to ' + TEAM_FILE_READ_MAX_LINE_LENGTH);
    expect(truncateTeamLine(text).startsWith('x'.repeat(TEAM_FILE_READ_MAX_LINE_LENGTH))).toBe(true);
  });

  it('budgets the rendered representation, not the text alone', () => {
    const line = 'y'.repeat(1990);
    const content = Array.from({ length: 60 }, () => line).join('\n');
    const rendered = renderTeamFile(content);
    expect(rendered.truncatedByBytes).toBe(true);
    const bytes = rendered.lines.reduce((total, entry) => total + renderedLineBytes(entry), 0);
    expect(bytes).toBeLessThanOrEqual(TEAM_FILE_READ_MAX_BYTES);
  });

  it('keeps the serialized read result within the byte budget', () => {
    const content = Array.from({ length: 2000 }, () => '').join('\n');
    const rendered = renderTeamFile(content);
    const result = { path: 'docs/empty.md', ...rendered, size: 3999, modifiedAt: '2026-01-01T00:00:00.000Z' };
    expect(rendered.truncatedByBytes).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8')).toBeLessThanOrEqual(TEAM_FILE_READ_MAX_BYTES + 1024);
  });

  it('refuses an invalid offset or limit and an oversized limit', () => {
    expect(codeOf(() => renderTeamFile('a', { offset: 0 }))).toBe('INVALID_INPUT');
    expect(codeOf(() => renderTeamFile('a', { limit: 0 }))).toBe('INVALID_INPUT');
    expect(codeOf(() => renderTeamFile('a', { limit: 5000 }))).toBe('INVALID_INPUT');
  });

  it('renders an empty file as zero lines', () => {
    expect(renderTeamFile('').totalLines).toBe(0);
  });
});
