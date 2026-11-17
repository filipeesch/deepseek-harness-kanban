import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';
import { createHostSessionRepair, sessionsRootOf } from '../../src/host/session-repair-host.js';
import { scanArtifact } from '../../src/host/session-repair.js';

const FRAME = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const frame = (text: string) => zstdCompressSync(Buffer.from(text + '\n', 'utf8'), FRAME);
const header = { id: 's1', version: 4, cwd: '/project', createdAt: '2026-01-01T00:00:00.000Z' };
const start = (seq: number) => ({ type: 'tool/ptc-dispatch-start', seq, data: { subCallId: 'call-A:ptc:1', rootCallId: 'call-A', parentCallId: 'call-A', name: 'bash', arguments: {} } });
const settle = (seq: number) => ({ type: 'tool/ptc-dispatch', seq, data: { subCallId: 'call-A:ptc:1', rootCallId: 'call-A', parentCallId: 'call-A', name: 'bash', arguments: {}, isError: false, content: [] } });
const rows = [start(1), settle(2), start(3), settle(4)];
const corrupt = () => Buffer.concat([frame(JSON.stringify(header)), ...rows.map(row => frame(JSON.stringify(row)))]);

let roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** One throwaway home with the JSONL sessions layout the host writes. */
async function home(): Promise<{ root: string; sessions: string; artifact: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kanban-repair-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  const directory = join(sessions, '--project--', 'session-s1');
  await mkdir(directory, { recursive: true });
  const artifact = join(directory, 'session.v4.jsonl.zstd');
  return { root, sessions, artifact };
}

describe('session repair on disk', () => {
  it('resolves the sessions root only for the layout it expects', () => {
    expect(sessionsRootOf('/home/.dsh/sessions/--p--/session-s1/session.v4.jsonl.zstd')).toBe('/home/.dsh/sessions');
    expect(sessionsRootOf('/tmp/elsewhere/project/session/session.v4.jsonl.zstd')).toBeUndefined();
  });

  it('keeps a backup, replaces atomically and leaves no staging file', async () => {
    const { root, artifact } = await home();
    const original = corrupt();
    await writeFile(artifact, original);
    const observe = vi.fn(async () => {});
    const repair = createHostSessionRepair({
      live: () => false,
      location: async () => ({ kind: 'jsonl', path: artifact, revision: 'r1' }),
      observe,
      validate: async () => {},
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await repair.repair('s1');
    expect(result.renamed).toBe(1);
    // The backup holds exactly the original bytes, outside the sessions tree.
    expect(await readFile(result.backupPath)).toEqual(original);
    expect(result.backupPath.startsWith(join(root, 'session-repair-backups'))).toBe(true);
    // The artifact holds the repaired bytes: the duplicate start is gone.
    const after = await readFile(artifact);
    const scan = scanArtifact(after);
    const starts = scan.rows.map(row => (row as { type?: string; data?: { subCallId?: string } })).filter(row => row.type === 'tool/ptc-dispatch-start').map(row => row.data?.subCallId);
    expect(starts).toEqual(['call-A:ptc:1', 'call-A:ptc:2']);
    expect(observe).toHaveBeenCalledWith('s1');
    // No dot-prefixed staging file survives in the session directory.
    const entries = await readdir(join(artifact, '..'));
    expect(entries.filter(name => name.includes('.kanban-repair-'))).toEqual([]);
  });

  it('restores the original artifact when the host still rejects the repaired log', async () => {
    const { artifact } = await home();
    const original = corrupt();
    await writeFile(artifact, original);
    const repair = createHostSessionRepair({
      live: () => false,
      location: async () => ({ kind: 'jsonl', path: artifact, revision: 'r1' }),
      observe: async () => { throw new Error('still corrupt'); },
      validate: async () => {},
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    await expect(repair.repair('s1')).rejects.toThrow('the original was restored');
    expect(await readFile(artifact)).toEqual(original);
  });

  it('leaves no partial staging file when the candidate cannot be written', async () => {
    const { artifact } = await home();
    const original = corrupt();
    await writeFile(artifact, original);
    const directory = join(artifact, '..');
    await chmod(directory, 0o555);
    try {
      const repair = createHostSessionRepair({
        live: () => false,
        location: async () => ({ kind: 'jsonl', path: artifact, revision: 'r1' }),
        observe: async () => {},
        validate: async () => {},
      });
      await expect(repair.repair('s1')).rejects.toThrow();
      expect(await readFile(artifact)).toEqual(original);
      expect((await readdir(directory)).filter(name => name.includes('.kanban-repair-'))).toEqual([]);
    } finally { await chmod(directory, 0o755); }
  });

  it('removes a partially written candidate when the write fails', async () => {
    const { artifact } = await home();
    const original = corrupt();
    await writeFile(artifact, original);
    const repair = createHostSessionRepair({
      live: () => false,
      location: async () => ({ kind: 'jsonl', path: artifact, revision: 'r1' }),
      observe: async () => {},
      validate: async () => {},
      // The candidate exists on disk when the failure surfaces, which the cleanup must handle.
      writeCandidate: async (path, bytes) => { await writeFile(path, bytes.subarray(0, 4)); throw new Error('disk full'); },
    });
    await expect(repair.repair('s1')).rejects.toThrow('disk full');
    expect(await readFile(artifact)).toEqual(original);
    expect((await readdir(join(artifact, '..'))).filter(name => name.includes('.kanban-repair-'))).toEqual([]);
  });

  it('refuses without a backup location and never writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-kanban-repair-'));
    roots.push(directory);
    const artifact = join(directory, 'session.v4.jsonl.zstd');
    const original = corrupt();
    await writeFile(artifact, original);
    const repair = createHostSessionRepair({
      live: () => false,
      location: async () => ({ kind: 'jsonl', path: artifact, revision: 'r1' }),
      observe: async () => {},
      validate: async () => {},
    });
    await expect(repair.repair('s1')).rejects.toThrow('no backup can be kept');
    expect(await readFile(artifact)).toEqual(original);
    expect(resolve(artifact, '..')).toBe(directory);
  });
});
