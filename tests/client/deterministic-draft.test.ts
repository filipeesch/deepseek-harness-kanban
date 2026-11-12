import { describe, expect, it } from 'vitest';
import { deterministicDraft, deterministicDefinition, deterministicProblems } from '../../src/client/stage/deterministic-draft.js';
import { stageDraft, stagePatch, draftChanged, draftProblems, stageRenameBlock } from '../../src/client/stage/stage-editor-draft.js';
import type { Column } from '../../src/shared/types.js';
const column: Column = { id: 'wait', name: 'Wait', deterministic: { language: 'typescript', code: '  await tools.bash({command:"sleep 1"});\nreturn {exit:"ok",message:"done"};\n', directory: 'task', env: ['TOKEN'], exits: { ok: 'done', cached: 'done' } } };
const targets = new Set(['done']);
describe('deterministic authoring draft', () => {
  it('preserves source bytes and distinct exits to the same target', () => {
    const draft = stageDraft(column);
    expect(draftChanged(draft, column)).toBe(false);
    expect(draftProblems(draft, targets)).toEqual([]);
    expect(stagePatch(draft, column)).toEqual({});
    expect(deterministicDefinition(draft.deterministic!)).toEqual(column.deterministic);
    expect(stagePatch({ ...draft, name: 'CI' }, column)).toEqual({ name: 'CI' });
  });
  it('switches modes in a single mutually exclusive patch', () => {
    const agent: Column = { id: 'wait', name: 'Wait', onEnterPrompt: 'hello', allowedTransitions: [{ to: 'done' }] };
    const draft = { ...stageDraft(agent), execution: 'deterministic' as const, deterministic: deterministicDraft(column.deterministic), onEnterPrompt: '', mode: 'any' as const, transitions: [] };
    expect(stagePatch(draft, agent)).toMatchObject({ deterministic: column.deterministic, onEnterPrompt: null, allowedTransitions: null });
    expect(stagePatch({ ...stageDraft(column), execution: 'agent', onEnterPrompt: 'Inspect CI' }, column)).toEqual({ deterministic: null, onEnterPrompt: 'Inspect CI' });
  });
  it('rejects mixed prompt/routing sources rather than silently clearing them', () => {
    expect(draftProblems({ ...stageDraft(column), onEnterPrompt: 'also run' }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'execution' })]));
    expect(draftProblems({ ...stageDraft(column), mode: 'none' }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'execution' })]));
  });
  it('uses exactly one source and allows multiline TypeScript function bodies', () => {
    const draft = { ...deterministicDraft(column.deterministic), source: 'file' as const, file: 'scripts/wait.ts' };
    expect(deterministicDefinition(draft)).not.toHaveProperty('code');
    expect(deterministicDefinition(draft).file).toBe('scripts/wait.ts');
    expect(deterministicProblems({ ...draft, file: '' }, targets)[0]?.field).toBe('source');
  });
  it.each(['bad name', '_bad', '', 'ok'])('validates unique exit names: %s', name => {
    expect(deterministicProblems({ ...deterministicDraft(column.deterministic), exits: [{ name, to: 'done' }, { name, to: 'done' }] }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'exits' })]));
  });
  it('rejects missing/self targets and duplicate/invalid variable names', () => {
    const draft = { ...deterministicDraft(column.deterministic), env: 'TOKEN,TOKEN,BAD=VALUE', exits: [{ name: 'ok', to: 'wait' }] };
    expect(deterministicProblems(draft, targets).map(problem => problem.field)).toEqual(expect.arrayContaining(['env', 'exits']));
  });
  it('blocks stage id edits during directly owned script work', () => {
    const task = { id: 't', columnId: 'wait' } as never;
    expect(stageRenameBlock([task], {}, { t: { phase: 'result-ready' } as never })).toContain('deterministic execution');
    expect(stageRenameBlock([task], {}, { t: { phase: 'stopped' } as never })).toBeNull();
  });
});
