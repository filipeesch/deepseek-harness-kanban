import { describe, expect, it } from 'vitest';
import { KanbanError } from '../../src/shared/errors.js';
import { boardProblemOf, formatProblem, needsPluginUpdate, parseBoardLog, PLUGIN_UPDATE_REQUIRED } from '../../src/host/sharing/board-compatibility.js';

const AT = '2026-01-01T00:00:00.000Z';

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

describe('board compatibility boundary', () => {
  it('reads a log this installation understands', () => {
    const text = [line({ kind: 'workflow.replaced', text: 'name: Board' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 })].join(String.fromCharCode(10));
    expect(parseBoardLog(text, 'board').length).toBe(1);
  });

  it('reports a newer event version as a plugin-update state', () => {
    const text = [line({ kind: 'workflow.replaced', text: 'name: Board' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 }), line({ kind: 'board.removed', seq: 1, at: AT, v: 99 })].join(String.fromCharCode(10));
    expect(() => parseBoardLog(text, 'board')).toThrow(expect.objectContaining({ code: PLUGIN_UPDATE_REQUIRED }));
    try { parseBoardLog(text, 'board'); } catch (error) { expect(boardProblemOf(error)).toMatchObject({ code: PLUGIN_UPDATE_REQUIRED }); }
    expect(needsPluginUpdate({ code: PLUGIN_UPDATE_REQUIRED, message: 'x' })).toBe(true);
  });

  it('reports an unknown change as a plugin-update state', () => {
    const decoded = formatProblem({ ok: false, reason: 'unknown-kind', kind: 'stage.teleported' });
    expect(decoded).toMatchObject({ code: PLUGIN_UPDATE_REQUIRED });
    expect(decoded?.message).toContain('does not know');
  });

  it('does not treat a malformed log as a version boundary', () => {
    expect(formatProblem({ ok: false, reason: 'invalid', message: 'bad' })).toBeNull();
    expect(() => parseBoardLog('not json', 'board')).toThrow(expect.objectContaining({ code: 'SHARING_INVALID_DOCUMENT' }));
  });

  it('ignores a failure that is not the boundary', () => {
    expect(boardProblemOf(new KanbanError('SHARING_FAILED', 'x'))).toBeNull();
    expect(boardProblemOf(new Error('x'))).toBeNull();
    expect(needsPluginUpdate(null)).toBe(false);
  });
});
