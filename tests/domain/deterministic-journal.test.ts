import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { deriveChanges } from '../../src/domain/journal/derive.js';
import { applyEvents } from '../../src/domain/journal/conflict.js';
import { decodeEvent, encodeEvent } from '../../src/domain/journal/event.js';
import { appendEvents, compactBoardLog, createBoardLog, decodeBoardLog, encodeBoardLog, headToken, recoverBoard } from '../../src/domain/journal/log.js';
import { canonicalWorkflow } from '../../src/domain/schema-parts.js';
import { SHARED_MANIFEST_VERSION } from '../../src/domain/sharing/manifest.js';

const AT = '2026-01-01T00:00:00.000Z';
const BASE = '# root stays\nname: Flow\ncolumns:\n  - id: wait\n    key: wait-key\n    label: "Wait" # label stays\n  - {id: done, key: done-key, label: Done}\n  - {id: repair, key: repair-key, label: Repair}\n';
const definition = { language: 'typescript' as const, directory: 'task' as const, code: 'await Promise.resolve();\nreturn {exit: "ok", message: "Ready"};\n', env: ['CI_TOKEN'], exits: { ok: 'done', error: 'repair' } };
const deterministic = (definitionValue: unknown = definition) => BASE.replace('    label: "Wait" # label stays', '    label: "Wait" # label stays\n    deterministic: ' + JSON.stringify(definitionValue));
function roundTrip(before: string, after: string) {
  const changes = deriveChanges({ text: before }, { text: after });
  const log = appendEvents(createBoardLog(before), changes, AT);
  const result = recoverBoard(log, null);
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
    const result = roundTrip(BASE, deterministic()); const encoded = JSON.stringify(encodeBoardLog(result.log));
    for (const forbidden of ['sourceRef','fingerprint','executionId','configured','credentialRef','localStageIdentities']) expect(encoded).not.toContain(forbidden);
    expect(encoded).toContain('CI_TOKEN'); expect(encoded).not.toContain('actual-secret-value');
  });
  it('keeps deterministic event decoding strict and source bytes lossless', () => {
    const event = { kind: 'stage.field-changed' as const, key: 'wait-key', field: 'deterministic' as const, value: definition, seq: 1, at: AT, v: 2 };
    expect(decodeEvent(encodeEvent(event))).toEqual({ ok: true, event });
    expect(decodeEvent({ ...event, value: { ...definition, value: 'secret' } }).ok).toBe(false);
    expect(decodeEvent({ ...event, value: { ...definition, file: 'also.ts' } }).ok).toBe(false);
  });
});

describe('v1/v2/v3 compatibility and content heads', () => {
  it('signals script-bearing genesis before events or workflow interpretation', () => {
    expect(SHARED_MANIFEST_VERSION).toBe(3);
    const fresh = createBoardLog(deterministic()); expect(fresh.version).toBe(3); expect(fresh.events).toEqual([]);
    expect(decodeBoardLog(encodeBoardLog(fresh))).toEqual({ ok: true, log: fresh });
    expect(decodeBoardLog({ ...encodeBoardLog(fresh), version: 4 })).toEqual({ ok: false, reason: 'unsupported-version', version: 4 });
    expect(decodeBoardLog({ ...encodeBoardLog(fresh), version: 1 })).toEqual({ ok: false, reason: 'unsupported-version', version: 3 });
  });
  it('refuses executable events hidden under a legacy envelope or event stamp', () => {
    const event = { kind: 'stage.field-changed' as const, key: 'wait-key', field: 'deterministic' as const, value: definition, seq: 1, at: AT, v: 2 };
    expect(decodeEvent({ ...event, v: 1 })).toEqual({ ok: false, reason: 'unsupported-version', version: 3 });
    expect(decodeBoardLog({ version: 1, snapshot: { text: BASE, seq: 0 }, events: [event] })).toEqual({ ok: false, reason: 'unsupported-version', version: 3 });
  });
  it('preserves a legacy log canonical head and every retained historical stamp on read/upgrade', () => {
    const old = appendEvents(createBoardLog(BASE), [{ kind: 'workflow.field-changed', field: 'name', value: 'Flow renamed' }], AT);
    const encoded = encodeBoardLog(old);
    const canonical = JSON.stringify({ version: old.version, snapshot: { seq: old.snapshot.seq, text: old.snapshot.text }, events: old.events });
    const expectedHead = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(headToken(old)).toBe(expectedHead);
    const decoded = decodeBoardLog(encoded); expect(decoded.ok).toBe(true); if (!decoded.ok) return;
    expect(decoded.log.version).toBe(1); expect(headToken(decoded.log)).toBe(expectedHead);
    const upgraded = appendEvents(decoded.log, [{ kind: 'stage.field-changed', key: 'wait-key', field: 'deterministic', value: definition }], '2026-01-02T00:00:00.000Z');
    expect(upgraded.version).toBe(3); expect(upgraded.events[0]).toEqual(old.events[0]);
    expect(encodeEvent(upgraded.events[0]!)).toEqual(encodeEvent(old.events[0]!)); expect(upgraded.events[1]?.v).toBe(3);
  });
  it('keeps the envelope after compaction and later removal of the last executable definition', () => {
    const { log } = roundTrip(BASE, deterministic());
    const compacted = compactBoardLog(log, 0); expect(compacted.version).toBe(3); expect(compacted.events).toEqual([]);
    expect(parseWorkflow(compacted.snapshot.text).columns[0]?.deterministic).toEqual(definition);
    const cleared = compactBoardLog(appendEvents(compacted, [{ kind: 'stage.field-changed', key: 'wait-key', field: 'deterministic', value: null }], AT), 0);
    expect(cleared.version).toBe(3); expect(encodeBoardLog(cleared).version).toBe(3);
    expect(parseWorkflow(cleared.snapshot.text).columns[0]?.deterministic).toBeUndefined();
    const decoded = decodeBoardLog(encodeBoardLog(cleared)); expect(decoded.ok).toBe(true); if (decoded.ok) expect(decoded.log.version).toBe(3);
  });
});
