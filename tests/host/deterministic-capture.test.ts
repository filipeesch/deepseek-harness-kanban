import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeterministicCaptureStore } from '../../src/host/deterministic/capture.js';
import type { DeterministicPolicyPort } from '../../src/host/deterministic/ports.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const policy: DeterministicPolicyPort = {
  async directory(path) { return path; },
  async source(path) { return { path, code: 'return {exit: "ok", message: "ok"}' }; },
  async execution() { throw new Error('not used by capture'); },
};
const exits = { ok: { columnId: 'done', stageIdentity: 'done-key' } };

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'kanban-capture-'));
  roots.push(root);
  return new DeterministicCaptureStore(root, policy);
}
function definition(params?: Array<{ name: string; description?: string }>) {
  return { language: 'typescript' as const, code: 'return {exit: "ok", message: "ok"}', directory: 'task' as const, ...(params === undefined ? {} : { params }), exits: { ok: 'done' } };
}

describe('deterministic capture parameter authority', () => {
  it('changes the fingerprint when a declared name changes', async () => {
    const captures = await store();
    const before = await captures.capture({ definition: definition([{ name: 'pipeline' }]), projectDirectory: '/repo', exits });
    const after = await captures.capture({ definition: definition([{ name: 'app' }]), projectDirectory: '/repo', exits });
    expect(before.fingerprint).not.toBe(after.fingerprint);
    expect(before.params).toEqual(['pipeline']);
    expect(after.params).toEqual(['app']);
  });
  it('keeps the fingerprint for a description change, a value, or a name reorder', async () => {
    const captures = await store();
    const plain = await captures.capture({ definition: definition([{ name: 'pipeline' }, { name: 'app' }]), projectDirectory: '/repo', exits });
    const described = await captures.capture({ definition: definition([{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }]), projectDirectory: '/repo', exits });
    const reordered = await captures.capture({ definition: definition([{ name: 'app' }, { name: 'pipeline' }]), projectDirectory: '/repo', exits });
    expect(described.fingerprint).toBe(plain.fingerprint);
    expect(reordered.fingerprint).toBe(plain.fingerprint);
    expect(plain.params).toEqual(['app', 'pipeline']);
  });
  it('captures no value and loads the exact primary bytes', async () => {
    const captures = await store();
    const capture = await captures.capture({ definition: definition([{ name: 'pipeline' }]), projectDirectory: '/repo', exits });
    expect(JSON.stringify(capture)).not.toContain('local-ci');
    expect(JSON.parse(JSON.stringify(capture))).not.toHaveProperty('parameters');
    expect(await captures.load(capture)).toBe('return {exit: "ok", message: "ok"}');
  });
});
