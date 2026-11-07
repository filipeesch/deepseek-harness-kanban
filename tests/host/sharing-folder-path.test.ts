import { mkdir, mkdtemp, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { folderIdentity, inspectFolder, isWithinPath } from '../../src/host/sharing/local-folder-path.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-folder-path-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('folder inspection codes', () => {
  it('resolves one directory to its canonical identity', async () => {
    const root = await tempRoot();
    const folder = path.join(root, 'team');
    await mkdir(folder);
    const inspected = await inspectFolder(folder);
    expect(inspected.path).toBe(await realpath(folder));
    expect(inspected.identity).toBe(folderIdentity(inspected.path));
  });

  it('names a missing directory', async () => {
    const root = await tempRoot();
    await expect(inspectFolder(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'SHARING_FOLDER_MISSING' });
  });

  it('names a path that is a file', async () => {
    const root = await tempRoot();
    const file = path.join(root, 'file.txt');
    await writeFile(file, 'x', 'utf8');
    await expect(inspectFolder(file)).rejects.toMatchObject({ code: 'SHARING_FOLDER_NOT_DIRECTORY' });
  });
});

describe('path containment', () => {
  it('accepts the root itself and any descendant', async () => {
    const root = await tempRoot();
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(isWithinPath(root, root, 'linux')).toBe(true);
    expect(isWithinPath(root, nested, 'linux')).toBe(true);
  });

  it('rejects a sibling with a shared prefix', async () => {
    const root = await tempRoot();
    const sibling = path.join(root + '-other', 'a');
    await mkdir(sibling, { recursive: true });
    expect(isWithinPath(root, sibling, 'linux')).toBe(false);
  });

  it('rejects a lexical escape and the parent directory', async () => {
    const root = await tempRoot();
    const folder = path.join(root, 'team');
    await mkdir(folder);
    expect(isWithinPath(folder, path.join(folder, '..', 'other'), 'linux')).toBe(false);
    expect(isWithinPath(folder, root, 'linux')).toBe(false);
  });

  it('compares case-insensitively only on a case-insensitive platform', async () => {
    expect(isWithinPath('/Users/Member/Drive', '/Users/member/drive/Team', 'darwin')).toBe(true);
    expect(isWithinPath('/home/member/drive', '/home/member/Drive/Team', 'linux')).toBe(false);
  });

  it('reasons about Windows-style paths on any host', () => {
    expect(isWithinPath('C:\\Drive', 'C:\\Drive\\Team', 'win32')).toBe(true);
    expect(isWithinPath('C:\\Drive', 'c:\\drive\\team', 'win32')).toBe(true);
    expect(isWithinPath('C:\\Drive', 'D:\\Drive\\Team', 'win32')).toBe(false);
    expect(isWithinPath('C:\\Drive', 'C:\\Drive Two', 'win32')).toBe(false);
    expect(isWithinPath('C:\\Drive', 'C:\\Drive\\..\\Other', 'win32')).toBe(false);
  });

  it('follows the canonical form of a symbolic link outside the root', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const link = path.join(root, 'link');
    await symlink(outside, link);
    expect(isWithinPath(root, await realpath(link), 'linux')).toBe(false);
  });
});
