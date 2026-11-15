import { describe, expect, it } from 'vitest';
import { scriptedDraft, scriptedDefinition, scriptedProblems, EXIT_HELP } from '../../src/client/stage/scripted-draft.js';
import { stageDraft, stagePatch, draftChanged, draftProblems, stageRenameBlock, transitionChoices } from '../../src/client/stage/stage-editor-draft.js';
import type { Column } from '../../src/shared/types.js';
const column: Column = { id: 'wait', name: 'Wait', scripted: { language: 'typescript', code: '  await tools.bash({command:"sleep 1"});\nreturn {exit:"ok",message:"done"};\n', directory: 'task', env: ['TOKEN'], exits: { ok: 'done', cached: 'done' } } };
const targets = new Set(['done']);
describe('scripted authoring draft', () => {
  it('preserves source bytes and distinct exits to the same target', () => {
    const draft = stageDraft(column);
    expect(draftChanged(draft, column)).toBe(false);
    expect(draftProblems(draft, targets)).toEqual([]);
    expect(stagePatch(draft, column)).toEqual({});
    expect(scriptedDefinition(draft.scripted!)).toEqual(column.scripted);
    expect(stagePatch({ ...draft, name: 'CI' }, column)).toEqual({ name: 'CI' });
  });
  it('rejects a draft that authors a program and an instruction at once', () => {
    const mixed = { ...stageDraft(column), onEnterPrompt: 'also run', mode: 'restricted' as const, transitions: [{ to: 'done', when: '' }] };
    expect(draftProblems(mixed, targets).map(problem => problem.field)).toContain('execution');
  });
  it('switches modes in a single mutually exclusive patch', () => {
    const agent: Column = { id: 'wait', name: 'Wait', onEnterPrompt: 'hello', allowedTransitions: [{ to: 'done' }] };
    const draft = { ...stageDraft(agent), execution: 'scripted' as const, scripted: scriptedDraft(column.scripted), onEnterPrompt: '', mode: 'any' as const, transitions: [] };
    expect(stagePatch(draft, agent)).toMatchObject({ scripted: column.scripted, onEnterPrompt: null, allowedTransitions: null });
    expect(stagePatch({ ...stageDraft(column), execution: 'agent', onEnterPrompt: 'Inspect CI' }, column)).toEqual({ scripted: null, onEnterPrompt: 'Inspect CI' });
  });
  it('rejects mixed prompt/routing sources rather than silently clearing them', () => {
    expect(draftProblems({ ...stageDraft(column), onEnterPrompt: 'also run' }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'execution' })]));
    expect(draftProblems({ ...stageDraft(column), mode: 'none' }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'execution' })]));
  });
  it('uses exactly one source and allows multiline TypeScript function bodies', () => {
    const draft = { ...scriptedDraft(column.scripted), source: 'file' as const, file: 'scripts/wait.ts' };
    expect(scriptedDefinition(draft)).not.toHaveProperty('code');
    expect(scriptedDefinition(draft).file).toBe('scripts/wait.ts');
    expect(scriptedProblems({ ...draft, file: '' }, targets)[0]?.field).toBe('source');
  });
  it.each(['bad name', '_bad', '', 'ok'])('validates unique exit names: %s', name => {
    expect(scriptedProblems({ ...scriptedDraft(column.scripted), exits: [{ name, to: 'done' }, { name, to: 'done' }] }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'exits' })]));
  });
  it('rejects missing/self targets and duplicate/invalid variable names', () => {
    const draft = { ...scriptedDraft(column.scripted), env: 'TOKEN,TOKEN,BAD=VALUE', exits: [{ name: 'ok', to: 'wait' }] };
    expect(scriptedProblems(draft, targets).map(problem => problem.field)).toEqual(expect.arrayContaining(['env', 'exits']));
  });
  it('round-trips declared parameters and validates them before a save', () => {
    const withParameters: Column = { id: 'wait', name: 'Wait', scripted: { ...column.scripted!, params: [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }] } };
    const draft = stageDraft(withParameters);
    expect(draftChanged(draft, withParameters)).toBe(false);
    expect(draftProblems(draft, targets)).toEqual([]);
    expect(stagePatch(draft, withParameters)).toEqual({});
    expect(scriptedDefinition(draft.scripted!)).toEqual(withParameters.scripted);
    const added = { ...draft, scripted: { ...draft.scripted!, params: [...draft.scripted!.params, { name: 'environment', description: '' }] } };
    expect(scriptedDefinition(added.scripted!).params).toEqual([{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }, { name: 'environment' }]);
    expect(stagePatch(added, withParameters).scripted?.params).toHaveLength(3);
  });
  it('rejects an invalid parameter declaration with an inline problem', () => {
    const base = scriptedDraft(column.scripted);
    for (const params of [
      [{ name: '', description: '' }],
      [{ name: 'bad name', description: '' }],
      [{ name: 'pipeline', description: '' }, { name: 'pipeline', description: '' }],
      [{ name: 'pipeline', description: 'x'.repeat(201) }],
    ]) expect(scriptedProblems({ ...base, params }, targets)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'params' })]));
  });
  it('documents both reserved destinations and keeps the stage out of the target choices', () => {
    expect(EXIT_HELP).toContain('error');
    expect(EXIT_HELP).toContain('infrastructure');
    expect(transitionChoices([{ id: 'wait', name: 'Wait' }, { id: 'done', name: 'Done' }], 'wait').map(column => column.id)).toEqual(['done']);
  });
  it('blocks stage id edits during directly owned script work', () => {
    const task = { id: 't', columnId: 'wait' } as never;
    expect(stageRenameBlock([task], {}, { t: { phase: 'result-ready' } as never })).toContain('scripted execution');
    expect(stageRenameBlock([task], {}, { t: { phase: 'stopped' } as never })).toBeNull();
  });
});
