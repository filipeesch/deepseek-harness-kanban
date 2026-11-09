import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KanbanError } from '../../src/shared/errors.js';
import {
  TEAM_FILE_MAX_INPUT_BYTES,
  TEAM_FILE_READ_MAX_BYTES,
  TEAM_FILE_READ_MAX_LINE_LENGTH,
  TEAM_FILE_READ_MAX_LINES,
  TEAM_FILE_SEARCH_DEADLINE_MS,
  TEAM_FILE_SEARCH_MAX_MATCHES,
  TEAM_FILE_SEARCH_MAX_OUTPUT_BYTES,
  TEAM_FILE_SEARCH_MAX_PATHS,
} from '../../src/host/team-files/limits.js';
import { normalizeTeamFilePath, TeamFileRoot } from '../../src/host/team-files/root.js';

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-files-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function syncCode(run: () => unknown): string {
  try { run(); } catch (error) { return error instanceof KanbanError ? error.code : 'NOT_A_KANBAN_ERROR'; }
  return 'NO_ERROR';
}

describe('team file limits', () => {
  it('match the host read, glob, and grep bounds and add the input cap', () => {
    expect(TEAM_FILE_READ_MAX_LINES).toBe(2000);
    expect(TEAM_FILE_READ_MAX_BYTES).toBe(50 * 1024);
    expect(TEAM_FILE_READ_MAX_LINE_LENGTH).toBe(2000);
    expect(TEAM_FILE_SEARCH_MAX_PATHS).toBe(100);
    expect(TEAM_FILE_SEARCH_MAX_MATCHES).toBe(250);
    expect(TEAM_FILE_SEARCH_MAX_OUTPUT_BYTES).toBe(50 * 1024);
    expect(TEAM_FILE_SEARCH_DEADLINE_MS).toBe(30_000);
    expect(TEAM_FILE_MAX_INPUT_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('team file path gate', () => {
  it('normalizes a relative path and keeps surrounding spaces as part of the name', () => {
    expect(normalizeTeamFilePath('docs/guide.md')).toBe('docs/guide.md');
    expect(normalizeTeamFilePath(' docs/guide.md ')).toBe(' docs/guide.md ');
  });

  it('refuses an absolute path, a drive path, and an empty value', () => {
    expect(syncCode(() => normalizeTeamFilePath('/etc/passwd'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('C:/notes.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath(''))).toBe('INVALID_INPUT');
    expect(syncCode(() => normalizeTeamFilePath(4))).toBe('INVALID_INPUT');
  });

  it('refuses a control character before any trimming could hide it', () => {
    expect(syncCode(() => normalizeTeamFilePath('\tdocs/a.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('docs/a.md\n'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('docs/a\u0000.md'))).toBe('TEAM_FILE_PATH_INVALID');
  });

  it('refuses a traversal, a backslash, an empty segment, and an oversized value', () => {
    expect(syncCode(() => normalizeTeamFilePath('docs/../../secret.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('./docs/a.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('docs\\a.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('docs//a.md'))).toBe('TEAM_FILE_PATH_INVALID');
    expect(syncCode(() => normalizeTeamFilePath('x'.repeat(2000)))).toBe('TEAM_FILE_PATH_INVALID');
  });

  it('reserves the trash under any casing and every entry inside it', () => {
    expect(syncCode(() => normalizeTeamFilePath('.trash'))).toBe('TEAM_FILE_TRASH_RESERVED');
    expect(syncCode(() => normalizeTeamFilePath('.TRASH/docs/a.md'))).toBe('TEAM_FILE_TRASH_RESERVED');
    expect(normalizeTeamFilePath('.trash/docs/a.md', { allowTrash: true })).toBe('.trash/docs/a.md');
  });
});

describe('team file root', () => {
  it('accepts a document reached through a symbolic link that stays inside', async () => {
    const directory = await temporary();
    const target = path.join(directory, 'real');
    await mkdir(target);
    await writeFile(path.join(target, 'notes.md'), 'hello', 'utf8');
    await symlink(path.join(target, 'notes.md'), path.join(directory, 'link.md'));
    const root = new TeamFileRoot(directory);
    expect(await root.canonical('link.md')).toBe(path.join(await realpath(directory), 'real', 'notes.md'));
  });

  it('refuses a symbolic link that leaves the directory', async () => {
    const directory = await temporary();
    const outside = await temporary();
    await writeFile(path.join(outside, 'secret.md'), 'secret', 'utf8');
    await symlink(path.join(outside, 'secret.md'), path.join(directory, 'escape.md'));
    const root = new TeamFileRoot(directory);
    await expect(root.canonical('escape.md')).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
  });

  it('refuses a symbolic link alias that resolves into the trash', async () => {
    const directory = await temporary();
    await mkdir(path.join(directory, '.trash', 'docs'), { recursive: true });
    await writeFile(path.join(directory, '.trash', 'docs', 'gone.md'), 'gone', 'utf8');
    await symlink(path.join(directory, '.trash'), path.join(directory, 'archive'));
    const root = new TeamFileRoot(directory);
    await expect(root.canonical('archive/docs/gone.md')).rejects.toMatchObject({ code: 'TEAM_FILE_TRASH_RESERVED' });
    expect(await root.isTrashPath(path.join(await realpath(directory), '.trash', 'docs', 'gone.md'))).toBe(true);
  });

  it('validates every existing ancestor before a write creates directories', async () => {
    const directory = await temporary();
    const outside = await temporary();
    await symlink(outside, path.join(directory, 'escape'));
    const root = new TeamFileRoot(directory);
    await expect(root.resolveForWrite('escape/nested/file.md')).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
    expect(await lstat(path.join(outside, 'nested')).catch(() => null)).toBeNull();
  });

  it('returns null for a missing entry and refuses a relative root', async () => {
    const directory = await temporary();
    const root = new TeamFileRoot(directory);
    expect(await root.canonical('missing.md')).toBeNull();
    expect(syncCode(() => new TeamFileRoot('relative/dir'))).toBe('TEAM_FILES_UNAVAILABLE');
  });
});
