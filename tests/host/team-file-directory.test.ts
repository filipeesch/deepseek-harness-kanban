import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TEAM_FILES_TRASH_DIRECTORY } from '../../src/shared/types.js';
import { DirectoryTeamFileStore, TeamFileDirectory } from '../../src/host/sharing/team-file-directory.js';

const directories: string[] = [];
async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-dir-')));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function storeIn(base: string, attempts?: number): Promise<DirectoryTeamFileStore> {
  return new DirectoryTeamFileStore(new TeamFileDirectory(path.join(base, 'team-files'), attempts === undefined ? {} : { collisionAttempts: attempts }));
}

describe('directory team file store', () => {
  it('creates the owned directory on demand and refuses a missing location', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    expect(await store.list()).toEqual([]);
    await store.ensure();
    expect(await store.list()).toEqual([]);
    const missing = new DirectoryTeamFileStore(new TeamFileDirectory(path.join(base, 'absent', 'team-files')));
    await expect(missing.ensure()).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });
  });

  it('writes nested paths, reads the bytes back, and lists them ordered', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    const written = await store.write('docs/b.md', 'beta', { operation: 'create' });
    await store.write('docs/a.md', 'alpha', { operation: 'create' });
    expect(written.size).toBe(4);
    expect((await store.list()).map(entry => entry.path)).toEqual(['docs/a.md', 'docs/b.md']);
    const content = await store.read('docs/a.md');
    expect(content).not.toBeNull();
    expect(Buffer.from(content!.bytes).toString('utf8')).toBe('alpha');
    expect(content!.size).toBe(5);
  });

  it('replaces a file through a temporary sibling and never exposes a partial file', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    const first = 'first'.repeat(2000);
    const second = 'second'.repeat(2000);
    await store.write('notes.md', first, { operation: 'create' });
    let writing = true;
    const writer = (async () => {
      try {
        for (let index = 0; index < 20; index++) await store.write('notes.md', index % 2 === 0 ? second : first, { operation: 'edit' });
      } finally { writing = false; }
    })();
    const observed = new Set<string>();
    // A bounded observation window: a failed write must not turn this into a spin.
    for (let reads = 0; writing && reads < 500; reads++) {
      const content = await store.read('notes.md');
      observed.add(Buffer.from(content!.bytes).toString('utf8'));
    }
    await writer;
    expect([...observed].every(value => value === first || value === second)).toBe(true);
    expect(await readFile(path.join(base, 'team-files', 'notes.md'), 'utf8')).toBe(first);
    expect((await store.list()).map(entry => entry.path)).toEqual(['notes.md']);
  });

  it('refuses to write through an escaping symlink before creating anything', async () => {
    const base = await temporary();
    const outside = await temporary();
    await mkdir(path.join(base, 'team-files'), { recursive: true });
    await symlink(outside, path.join(base, 'team-files', 'escape'));
    const store = await storeIn(base);
    await expect(store.write('escape/nested/file.md', 'x', { operation: 'create' })).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
    expect(await lstat(path.join(outside, 'nested')).catch(() => null)).toBeNull();
  });

  it('refuses to replace a symbolic link, and skips aliases out of reach', async () => {
    const base = await temporary();
    const outside = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    await writeFile(path.join(outside, 'secret.md'), 'secret', 'utf8');
    await symlink(path.join(outside, 'secret.md'), path.join(base, 'team-files', 'escape.md'));
    await expect(store.write('escape.md', 'changed', { operation: 'edit' })).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
    expect((await store.list()).map(entry => entry.path)).toEqual([]);
    expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('secret');
  });

  it('keeps the trash and an alias to it out of reach and out of the listing', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    await mkdir(path.join(base, 'team-files', 'real'), { recursive: true });
    await writeFile(path.join(base, 'team-files', 'real', 'a.md'), 'alpha', 'utf8');
    await symlink(path.join(base, 'team-files', 'real', 'a.md'), path.join(base, 'team-files', 'link.md'));
    await mkdir(path.join(base, 'team-files', TEAM_FILES_TRASH_DIRECTORY, 'docs'), { recursive: true });
    await writeFile(path.join(base, 'team-files', TEAM_FILES_TRASH_DIRECTORY, 'docs', 'gone.md'), 'gone', 'utf8');
    await symlink(path.join(base, 'team-files', TEAM_FILES_TRASH_DIRECTORY), path.join(base, 'team-files', 'archive'));
    const paths = (await store.list()).map(entry => entry.path);
    expect(paths).toContain('link.md');
    expect(paths).toContain('real/a.md');
    expect(paths.some(value => value.startsWith(TEAM_FILES_TRASH_DIRECTORY) || value.startsWith('archive'))).toBe(false);
    await expect(store.read('archive/docs/gone.md')).rejects.toMatchObject({ code: 'TEAM_FILE_TRASH_RESERVED' });
  });

  it('moves a file into the trash without replacing an earlier entry and returns where it landed', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    await store.write('docs/notes.md', 'first', { operation: 'create' });
    const first = await store.move('docs/notes.md', '.trash/docs/notes.md.2026', { operation: 'delete' });
    expect(first.path).toBe('.trash/docs/notes.md.2026');
    expect(await store.read('docs/notes.md')).toBeNull();
    expect(await readFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026'), 'utf8')).toBe('first');
    await store.write('docs/notes.md', 'second', { operation: 'create' });
    const second = await store.move('docs/notes.md', '.trash/docs/notes.md.2026', { operation: 'delete' });
    expect(second.path).toBe('.trash/docs/notes.md.2026-2');
    expect(await readFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026-2'), 'utf8')).toBe('second');
    await expect(store.move('docs/missing.md', '.trash/docs/missing.md.2026', { operation: 'delete' })).rejects.toMatchObject({ code: 'TEAM_FILE_NOT_FOUND' });
  });

  it('fails safely when every candidate destination is occupied', async () => {
    const base = await temporary();
    const store = await storeIn(base, 2);
    await store.ensure();
    await mkdir(path.join(base, 'team-files', '.trash', 'docs'), { recursive: true });
    await writeFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026'), 'old-1', 'utf8');
    await writeFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026-2'), 'old-2', 'utf8');
    await store.write('docs/notes.md', 'source', { operation: 'create' });
    await expect(store.move('docs/notes.md', '.trash/docs/notes.md.2026', { operation: 'delete' })).rejects.toMatchObject({ code: 'TEAM_FILE_WRITE_FAILED' });
    expect(await readFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026'), 'utf8')).toBe('old-1');
    expect(await readFile(path.join(base, 'team-files', '.trash', 'docs', 'notes.md.2026-2'), 'utf8')).toBe('old-2');
    expect(await readFile(path.join(base, 'team-files', 'docs', 'notes.md'), 'utf8')).toBe('source');
  });

  it('creates without replacing an entry the listing never showed', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    await writeFile(path.join(base, 'team-files', '.team-file.hidden.tmp'), 'occupied', 'utf8');
    // The listing skips the temporary name, so only a non-replacing create can protect it.
    expect((await store.list()).some(entry => entry.path.startsWith('.team-file.'))).toBe(false);
    await expect(store.create('.team-file.hidden.tmp', 'x')).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
    expect(await readFile(path.join(base, 'team-files', '.team-file.hidden.tmp'), 'utf8')).toBe('occupied');
    await store.create('fresh.md', 'body');
    await expect(store.create('fresh.md', 'again')).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
    expect(await readFile(path.join(base, 'team-files', 'fresh.md'), 'utf8')).toBe('body');
  });

  it('refuses an owned directory that is a redirect, and a trash that is a symlink', async () => {
    const base = await temporary();
    const outside = await temporary();
    await symlink(outside, path.join(base, 'team-files'));
    const redirected = await storeIn(base);
    await expect(redirected.list()).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });
    await expect(redirected.write('a.md', 'x', { operation: 'create' })).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });

    const other = await temporary();
    const store = await storeIn(other);
    await store.ensure();
    await mkdir(path.join(other, 'team-files', 'docs'), { recursive: true });
    await mkdir(path.join(other, 'team-files', 'keep'), { recursive: true });
    await writeFile(path.join(other, 'team-files', 'docs', 'inside.md'), 'aliased', 'utf8');
    await writeFile(path.join(other, 'team-files', 'keep', 'notes.md'), 'body', 'utf8');
    await symlink(path.join(other, 'team-files', 'docs'), path.join(other, 'team-files', TEAM_FILES_TRASH_DIRECTORY));
    // The redirect makes everything under it unreachable, and no deletion follows it.
    await expect(store.read('docs/inside.md')).rejects.toMatchObject({ code: 'TEAM_FILE_TRASH_RESERVED' });
    await expect(store.move('keep/notes.md', '.trash/keep/notes.md.2026', { operation: 'delete' })).rejects.toMatchObject({ code: 'TEAM_FILE_WRITE_FAILED' });
    expect(await readFile(path.join(other, 'team-files', 'keep', 'notes.md'), 'utf8')).toBe('body');
  });

  it('refuses a read over the input cap without loading the file', async () => {
    const base = await temporary();
    const store = await storeIn(base);
    await store.ensure();
    await store.write('big.md', 'x'.repeat(2048), { operation: 'create' });
    await expect(store.read('big.md', { maxBytes: 10 })).rejects.toMatchObject({ code: 'TEAM_FILE_TOO_LARGE' });
    expect(await store.read('big.md', { maxBytes: 4096 })).not.toBeNull();
  });
});
