import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { deriveChanges } from '../../src/domain/journal/derive.js';
import { decodeEvent, encodeEvent } from '../../src/domain/journal/event.js';
import { appendEvents, encodeBoardLog, replay } from '../../src/domain/journal/log.js';
import { canonicalWorkflow } from '../../src/domain/schema-parts.js';
import { genesisLog } from '../support/board-log-fixture.js';

const AT = '2026-01-01T00:00:00.000Z';
const BASE = '# root stays\nname: Flow\ncolumns:\n  - id: wait\n    key: wait-key\n    label: "Wait" # label stays\n  - {id: done, key: done-key, label: Done}\n  - {id: repair, key: repair-key, label: Repair}\n';
const definition = { language: 'typescript' as const, directory: 'task' as const, code: 'await Promise.resolve();\nreturn {exit: "ok", message: "Ready"};\n', env: ['CI_TOKEN'], exits: { ok: 'done', error: 'repair' } };
const deterministic = (definitionValue: unknown = definition) => BASE.replace('    label: "Wait" # label stays', '    label: "Wait" # label stays\n    deterministic: ' + JSON.stringify(definitionValue));
function roundTrip(before: string, after: string) {
  const changes = deriveChanges({ text: before }, { text: after });
  const log = appendEvents(genesisLog(before), changes, AT);
  const result = replay(log, null);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.conflict.message);
  expect(canonicalWorkflow(parseWorkflow(result.text))).toBe(canonicalWorkflow(parseWorkflow(after)));
  return { changes, log, text: result.text };
}

describe('deterministic journal configuration', () => {
  it('replays creation, field edits, clear, and both coherent execution-mode switches', () => {
    const first = roundTrip(BASE, deterministic()); expect(first.changes).toContainEqual({ kind: 'stage.field-changed', key: 'wait-key', field: 'deterministic', value: definition });
    const file = { ...definition, code: undefined, file: '../scripts/wait.ts', directory: 'project' as const, exits: { ok: 'repair', error: 'done' }, env: ['OTHER_TOKEN'] };
    const edited = deterministic(file); roundTrip(deterministic(), edited);
    const conventional = BASE.replace('    label: "Wait" # label stays', '    label: "Wait" # label stays\n    on_enter_prompt: Review result\n    allowed_transitions: [done]');
    roundTrip(deterministic(), conventional); roundTrip(conventional, deterministic()); roundTrip(deterministic(), BASE);
    const added = deterministic().replace('  - {id: repair', '  - {id: added, key: added-key, label: Added, deterministic: {language: bash, file: poll.sh, exits: {ok: done}}}\n  - {id: repair');
    roundTrip(deterministic(), added);
  });
  it('carries declared parameter names and descriptions without values', () => {
    const declared = { ...definition, params: [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }] };
    const result = roundTrip(BASE, deterministic(declared));
    expect(parseWorkflow(result.text).columns[0]?.deterministic?.params).toEqual(declared.params);
    const encoded = JSON.stringify(encodeBoardLog(result.log));
    expect(encoded).toContain('pipeline');
    expect(encoded).toContain('CI workflow');
    expect(encoded).not.toContain('ci-main');
    expect(encoded).not.toContain('sourceRef');
  });
  it('keeps code bytes and unrelated comments and quoting in block and flow materializers', () => {
    const block = roundTrip(BASE, deterministic());
    expect(block.text).toContain('# root stays'); expect(block.text).toContain('label: "Wait" # label stays');
    expect(parseWorkflow(block.text).columns[0]?.deterministic?.code).toBe(definition.code);
    const flow = 'columns: [{id: wait, key: wait-key, label: "Wait"}, {id: done, key: done-key, label: Done}, {id: repair, key: repair-key, label: Repair}] # flow stays\n';
    const next = flow.replace('label: "Wait"}', 'label: "Wait", deterministic: ' + JSON.stringify(definition) + '}');
    const result = roundTrip(flow, next); expect(result.text).toContain('# flow stays'); expect(result.text).toContain('label: "Wait"');
  });
  it('derives a target rename as one identity event rather than an executable edit', () => {
    const before = deterministic(); const after = before.replaceAll('done', 'ready').replace('ready-key', 'done-key');
    const result = roundTrip(before, after);
    expect(result.changes).toEqual([{ kind: 'stage.id-changed', key: 'done-key', from: 'done', id: 'ready' }]);
    expect(parseWorkflow(result.text).columns[0]?.deterministic?.exits.ok).toBe('ready');
  });
  it('keeps dependent target removal and replacement atomic without changing source text', () => {
    const before = deterministic();
    const after = before.replace('"ok":"done"', '"ok":"repair"').replace('  - {id: done, key: done-key, label: Done}\n', '');
    const result = roundTrip(before, after);
    expect(result.changes).toEqual([{ kind: 'workflow.replaced', text: after }]);
    expect(result.text).toBe(after);
  });
  it('does not publish local runtime or credential authority', () => {
    const result = roundTrip(BASE, deterministic()); const encoded = encodeBoardLog(result.log);
    for (const forbidden of ['sourceRef', 'fingerprint', 'executionId', 'configured', 'credentialRef', 'localStageIdentities']) expect(encoded).not.toContain(forbidden);
    expect(encoded).toContain('CI_TOKEN'); expect(encoded).not.toContain('actual-secret-value');
  });
  it('keeps deterministic event decoding strict and source bytes lossless', () => {
    const event = { kind: 'stage.field-changed' as const, key: 'wait-key', field: 'deterministic' as const, value: definition, seq: 1, at: AT, v: 2 };
    expect(decodeEvent(encodeEvent(event))).toEqual({ ok: true, event });
    expect(decodeEvent({ ...event, value: { ...definition, value: 'secret' } }).ok).toBe(false);
    expect(decodeEvent({ ...event, value: { ...definition, file: 'also.ts' } }).ok).toBe(false);
  });
});
