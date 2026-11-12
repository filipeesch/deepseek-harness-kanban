import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { deterministicDefinitionSchema, deterministicEqual } from '../../src/domain/deterministic-definition.js';
import { canonicalWorkflow, workflow as workflowSchema } from '../../src/domain/schema-parts.js';
import { authoredTransitions, defaultDestination, transitionAccess, transitionTargets } from '../../src/domain/transitions.js';
import { resolveAutoAdvance } from '../../src/domain/auto-advance.js';
import { workflowGraph } from '../../src/domain/workflow-graph.js';
import { updateStage } from '../../src/domain/stage-update.js';

const definition = { language: 'typescript' as const, directory: 'task' as const, code: 'await Promise.resolve();\nreturn {exit: "ok", message: "Ready"};\n', exits: { ok: 'done', passed: 'done', error: 'repair' } };
const text = (value: unknown = definition) => 'name: Flow\ncolumns:\n  - id: wait\n    label: Wait\n    deterministic: ' + JSON.stringify(value) + '\n  - id: done\n    label: Done\n  - id: repair\n    label: Repair\n';

describe('deterministic definition codec', () => {
  it('defaults the directory and preserves exact executable bytes and repeated destinations', () => {
    const stage = parseWorkflow(text()).columns[0]!;
    expect(stage.deterministic).toEqual({ ...definition, directory: 'task' });
    expect(stage.deterministic?.code).toBe(definition.code);
    expect(workflowSchema.safeParse(parseWorkflow(text())).success).toBe(true);
  });
  it.each([
    { ...definition, file: 'wait.ts' }, { ...definition, code: undefined },
    { ...definition, code: '' }, { ...definition, code: undefined, file: ' ' },
    { ...definition, language: 'python' }, { ...definition, directory: 'ambient' },
    { ...definition, env: ['TOKEN', 'TOKEN'] }, { ...definition, env: ['a-b'] },
    { ...definition, exits: {} }, { ...definition, exits: { 'bad name': 'done' } },
    { ...definition, exits: { ok: 'missing' } }, { ...definition, exits: { ok: 'wait' } },
    { ...definition, exits: { ok: '../bad' } }, { ...definition, secret: 'never' },
  ])('rejects invalid definitions and route authority %#', value => { expect(() => parseWorkflow(text(value))).toThrow(); });
  it('rejects duplicate authored exit names and prompt/routing conflicts', () => {
    const base = text();
    expect(() => parseWorkflow(base.replace('    deterministic:', '    on_enter_prompt: Also run\n    deterministic:'))).toThrow();
    expect(() => parseWorkflow(base.replace('    deterministic:', '    allowed_transitions: []\n    deterministic:'))).toThrow();
    expect(() => parseWorkflow(base.replace(JSON.stringify(definition), '{language: bash, code: true, exits: {ok: done, ok: repair}}'))).toThrow();
    const workflow = parseWorkflow(base); workflow.columns[0]!.onEnterPrompt = 'Conflict';
    expect(workflowSchema.safeParse(workflow).success).toBe(false);
  });
  it('canonicalizes mappings/environment order without trimming primary code', () => {
    const a = deterministicDefinitionSchema.parse({ ...definition, env: ['B', 'A'] });
    const b = { ...a, exits: { error: 'repair', passed: 'done', ok: 'done' }, env: ['A', 'B'] };
    expect(deterministicEqual(a, b)).toBe(true);
    expect(deterministicEqual(a, { ...b, code: b.code + ' ' })).toBe(false);
    const left = parseWorkflow(text(a)); const right = parseWorkflow(text(b));
    expect(canonicalWorkflow(left)).toBe(canonicalWorkflow(right));
  });
  it('declares required parameters and rejects an invalid declaration', () => {
    const params = [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }];
    const stage = parseWorkflow(text({ ...definition, params })).columns[0]!;
    expect(stage.deterministic?.params).toEqual(params);
    expect(workflowSchema.safeParse(parseWorkflow(text({ ...definition, params }))).success).toBe(true);
    const invalid = [
      [{ name: 'pipeline' }, { name: 'pipeline' }],
      [{ name: 'bad name' }],
      [{ name: 'pipeline', description: '' }],
      [{ name: 'pipeline', description: 'x'.repeat(201) }],
      Array.from({ length: 33 }, (_, index) => ({ name: 'p' + index })),
    ];
    for (const value of invalid) expect(() => parseWorkflow(text({ ...definition, params: value }))).toThrow();
  });
  it('treats a change to a declared name as an authored change but not a value', () => {
    const declared = { ...definition, params: [{ name: 'pipeline' }] };
    expect(deterministicEqual(declared, { ...declared, params: [{ name: 'pipeline' }] })).toBe(true);
    expect(deterministicEqual(declared, { ...declared, params: [{ name: 'pipeline', description: 'CI' }] })).toBe(false);
    expect(deterministicEqual(declared, { ...declared, params: [{ name: 'app' }] })).toBe(false);
  });
  it('allows a parameterized stage as the initial stage and as an exit destination', () => {
    const yaml = ['initial_column: wait', 'columns:', '  - id: wait', '    label: Wait', '    deterministic: ' + JSON.stringify({ ...definition, params: [{ name: 'pipeline' }] }), '  - id: done', '    label: Done', '  - id: repair', '    label: Repair', ''].join(String.fromCharCode(10));
    const workflow = parseWorkflow(yaml);
    expect(workflow.initialColumnId).toBe('wait');
    expect(workflow.columns[0]?.deterministic?.exits.ok).toBe('done');
  });
  it('accepts the reserved infrastructure destination and still refuses a self-target', () => {
    const reserved = { ...definition, exits: { ok: 'done', error: 'repair', infrastructure: 'repair' } };
    const before = parseWorkflow(text(reserved));
    expect(before.columns[0]?.deterministic?.exits).toEqual({ ok: 'done', error: 'repair', infrastructure: 'repair' });
    expect(() => parseWorkflow(text({ ...reserved, exits: { ...reserved.exits, infrastructure: 'wait' } }))).toThrow(/own stage/);
    expect(before.columns[0]?.deterministic?.exits.infrastructure).toBe('repair');
  });
  it('updates a parameter declaration without touching the primary program', () => {
    const source = ['name: Flow', 'columns:', '  - id: wait', '    label: Wait', '    deterministic:', '      language: typescript', '      code: "echo exact"', '      params: [{name: pipeline}]', '      exits: {ok: done, passed: done, error: repair}', '  - {id: done, label: Done}', '  - {id: repair, label: Repair}', ''].join(String.fromCharCode(10));
    const before = parseWorkflow(source).columns[0]!.deterministic!;
    const result = updateStage({ text: source, stageId: 'wait', patch: { deterministic: { ...before, params: [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }] } } }).text;
    expect(parseWorkflow(result).columns[0]?.deterministic?.params).toEqual([{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }]);
    expect(parseWorkflow(result).columns[0]?.deterministic?.code).toBe('echo exact');
    expect(result).toContain('exits: {ok: done, passed: done, error: repair}');
  });
});

describe('deterministic routing', () => {
  it('derives unique exact targets but never a first-exit default', () => {
    const workflow = parseWorkflow(text());
    expect(authoredTransitions(workflow, 'wait')?.targets).toEqual([{ to: 'done' }, { to: 'repair' }]);
    expect(transitionTargets(workflow, 'wait').map(value => value.column.id)).toEqual(['done', 'repair']);
    expect(defaultDestination(workflow, 'wait')).toBeUndefined();
    expect(transitionAccess(workflow, 'wait', 'done')).toBe('allowed');
    expect(workflowGraph(workflow).connections.filter(value => value.from === 'wait').map(value => value.to)).toEqual(['done', 'repair']);
  });
  it('stops default agent advances at scripts and follows declared destinations exactly', () => {
    const workflow = parseWorkflow('columns:\n  - {id: agent, label: Agent}\n  - {id: manual, label: Manual}\n' + text().split('columns:\n')[1]);
    expect(resolveAutoAdvance(workflow, 'agent').path.map(value => value.id)).toEqual(['manual', 'wait']);
    expect(resolveAutoAdvance(workflow, 'agent', { exact: workflow.columns[1]! }).path.map(value => value.id)).toEqual(['manual']);
  });
});

describe('deterministic authored text edits', () => {
  it.each([false, true])('preserves primary bytes and unrelated text through mode edits, flow=%s', flow => {
    const base = flow ? 'columns: [{id: wait, label: "Wait"}, {id: done, label: Done}, {id: repair, label: Repair}] # keep\n' : text().replace('name: Flow', '# keep root\nname: Flow');
    const patched = updateStage({ text: base, stageId: 'wait', patch: { deterministic: { ...definition, language: 'typescript', directory: 'project' }, onEnterPrompt: null, allowedTransitions: null } }).text;
    expect(parseWorkflow(patched).columns[0]?.deterministic?.code).toBe(definition.code);
    expect(patched).toContain(flow ? '# keep' : '# keep root');
    const cleared = updateStage({ text: patched, stageId: 'wait', patch: { deterministic: null, onEnterPrompt: 'Now ask the model.' } }).text;
    expect(parseWorkflow(cleared).columns[0]).toMatchObject({ onEnterPrompt: 'Now ask the model.' });
    expect(parseWorkflow(cleared).columns[0]?.deterministic).toBeUndefined();
  });
  it.each([false, true])('keeps untouched nested executable fields and comments when routes/env change, flow=%s', flow => {
    const source = flow
      ? 'columns: [{id: wait, label: Wait, deterministic: {language: bash, code: "echo exact", env: [OLD], exits: {ok: done, error: repair}}}, {id: done, label: Done}, {id: repair, label: Repair}] # keep flow\n'
      : 'columns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash # keep language\n      code: | # keep code\n        echo exact\n      env: [OLD] # env comment\n      exits:\n        ok: done # keep ok\n        error: repair # route comment\n  - {id: done, label: Done}\n  - {id: repair, label: Repair}\n';
    const before = parseWorkflow(source).columns[0]!.deterministic!;
    const result = updateStage({ text: source, stageId: 'wait', patch: { deterministic: { ...before, env: ['NEW'], exits: { ...before.exits, error: 'done' } } } }).text;
    expect(parseWorkflow(result).columns[0]?.deterministic?.code).toBe(before.code);
    if (flow) expect(result).toContain('code: "echo exact"');
    else { expect(result).toContain('language: bash # keep language'); expect(result).toContain('code: | # keep code\n        echo exact'); expect(result).toContain('ok: done # keep ok'); }
  });
  it.each([false, true])('replaces all named exits without transient invalid empty mappings, flow=%s', flow => {
    const source = flow ? 'columns: [{id: wait, label: Wait, deterministic: {language: bash, code: "echo ready", exits: {old: done}}}, {id: done, label: Done}]\n' : 'columns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: echo ready\n      exits:\n        old: done\n  - {id: done, label: Done}\n';
    const before = parseWorkflow(source).columns[0]!.deterministic!;
    const result = updateStage({ text: source, stageId: 'wait', patch: { deterministic: { ...before, exits: { fresh: 'done' } } } });
    expect(parseWorkflow(result.text).columns[0]?.deterministic?.exits).toEqual({ fresh: 'done' });
  });
  it('renames only route target scalars, never script strings or comments', () => {
    const source = 'return {exit: "ok", message: "done"};\n';
    const base = 'columns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: typescript\n      code: ' + JSON.stringify(source) + ' # primary stays\n      exits: {ok: "done", error: \'done\'} # routes\n  - {id: done, label: Done}\n';
    const result = updateStage({ text: base, stageId: 'done', patch: { id: 'ready' } });
    expect(result.text).toContain('exits: {ok: "ready", error: \'ready\'} # routes');
    expect(result.text).toContain('# primary stays');
    expect(parseWorkflow(result.text).columns[0]?.deterministic?.code).toBe(source);
  });
});
