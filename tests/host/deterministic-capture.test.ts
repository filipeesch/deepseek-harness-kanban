import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeterministicCaptureStore } from '../../src/host/deterministic/capture.js';
import type { DeterministicPolicyPort } from '../../src/host/deterministic/ports.js';
import type { DeterministicCapture } from '../../src/shared/deterministic.js';

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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
async function rootedStore() {
  const root = await mkdtemp(join(tmpdir(), 'kanban-capture-'));
  roots.push(root);
  return { root, captures: new DeterministicCaptureStore(root, policy) };
}

describe('deterministic capture compatibility', () => {
  it('keeps a normalized blob until its adoption releases the pin', async () => {
    const { root, captures } = await rootedStore();
    const code = 'return {exit:"ok",message:"ok"}';
    const content = { language: 'typescript' as const, directory: 'task' as const, executionDirectory: '/repo/task', source: { kind: 'inline' as const }, env: [], params: [], exits };
    const legacy = createHash('sha256').update(canonical({ ...content, format: 'function-body', code })).digest('hex');
    const blob = canonical({ version: 1, content, code, fingerprint: legacy });
    const sourceRef = createHash('sha256').update(blob).digest('hex');
    await mkdir(join(root, 'sources'), { recursive: true });
    await writeFile(join(root, 'sources', sourceRef + '.json'), blob);
    const capture: DeterministicCapture = { ...content, sourceRef, fingerprint: legacy };
    const normalized = await captures.normalize(capture, definition());
    expect(normalized.sourceRef).not.toBe(sourceRef);
    await captures.collectSources([]);
    expect(await captures.load(normalized)).toBe(code);
    captures.releaseSource(normalized.sourceRef);
    await captures.collectSources([]);
    await expect(captures.load(normalized)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
  });
  it('loads a capture whose pre-upgrade fingerprint included the execution directory', async () => {
    const { root, captures } = await rootedStore();
    const code = 'return {exit:"ok",message:"ok"}';
    const content = { language: 'typescript' as const, directory: 'task' as const, executionDirectory: '/repo/task', source: { kind: 'inline' as const }, env: [], params: [], exits };
    const legacy = createHash('sha256').update(canonical({ ...content, format: 'function-body', code })).digest('hex');
    const blob = canonical({ version: 1, content, code, fingerprint: legacy });
    const sourceRef = createHash('sha256').update(blob).digest('hex');
    await mkdir(join(root, 'sources'), { recursive: true });
    await writeFile(join(root, 'sources', sourceRef + '.json'), blob);
    const capture: DeterministicCapture = { ...content, sourceRef, fingerprint: legacy };
    expect(await captures.load(capture)).toBe(code);
  });
});

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
