import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { KanbanError } from '../../src/shared/errors.js';
import type { TeamFileStore, TeamFileStoreResolution, TeamFileStoreSource } from '../../src/host/sharing/team-file-store.js';
import { DirectoryTeamFileStore, TeamFileDirectory } from '../../src/host/sharing/team-file-directory.js';
import { TeamFiles } from '../../src/host/team-files/service.js';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture, taskWithConversation } from './helpers.js';

const roots: string[] = [];
const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const exec = () => ({ signal: new AbortController().signal, agent: { id: 'ordinary-session' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext);
const taskExec = (sessionId: string) => ({ signal: new AbortController().signal, agent: { id: sessionId }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext);

function named(definitions: ToolDefinition[], name: string): ToolDefinition {
  const definition = definitions.find(value => value.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

function source(store: TeamFileStore, seen: string[] = []): TeamFileStoreSource {
  return {
    store: (hubId): TeamFileStoreResolution => { seen.push(hubId); return { store, provider: 'local-folder', label: 'Local folder', address: '/team-files' }; },
    exclusive: (_hubId, operation) => operation(),
  };
}

async function setupWithStore(store: TeamFileStore, seen: string[] = []) {
  const files = new TeamFiles(source(store, seen));
  const f = await fixture({ teamFiles: files });
  fixtures.push(f);
  return { ...f, tools: productToolDefinitions(f.app), seen };
}

async function setupWithFolder() {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-tools-')));
  roots.push(base);
  const store = new DirectoryTeamFileStore(new TeamFileDirectory(path.join(base, 'team-files')));
  return { ...(await setupWithStore(store)), base, store };
}

describe('team file tool surface', () => {
  it('exposes the five team file tools and no other file operation', async () => {
    const f = await setupWithStore(new DirectoryTeamFileStore(new TeamFileDirectory('/tmp/never-created')));
    const names = f.tools.map(tool => tool.name);
    expect(names).toContain('search_team_files');
    expect(names).toContain('read_team_file');
    expect(names).toContain('create_team_file');
    expect(names).toContain('edit_team_file');
    expect(names).toContain('delete_team_file');
    expect(names.some(name => /move_team_file|restore_team_file|list_team_storage/.test(name))).toBe(false);
  });

  it('marks reads concurrency-safe and writes not', async () => {
    const f = await setupWithStore(new DirectoryTeamFileStore(new TeamFileDirectory('/tmp/never-created')));
    const safe = (name: string, args: Record<string, unknown>): boolean => named(f.tools, name).isConcurrencySafe?.(args) === true;
    expect(safe('search_team_files', {})).toBe(true);
    expect(safe('read_team_file', { path: 'docs/a.md' })).toBe(true);
    expect(safe('create_team_file', { path: 'docs/a.md', content: 'x' })).toBe(false);
    expect(safe('edit_team_file', { path: 'docs/a.md', edits: [{ old: 'a', new: 'b' }] })).toBe(false);
    expect(safe('delete_team_file', { path: 'docs/a.md', confirmed: true })).toBe(false);
  });

  it('states the explicit-request rule in every write description', async () => {
    const f = await setupWithStore(new DirectoryTeamFileStore(new TeamFileDirectory('/tmp/never-created')));
    for (const name of ['create_team_file', 'edit_team_file', 'delete_team_file']) {
      expect(named(f.tools, name).description).toMatch(/explicitly/);
    }
  });
});

describe('team file tools end to end', () => {
  it('creates, searches, reads, edits, and deletes through the folder store', async () => {
    const f = await setupWithFolder();
    const run = exec();
    await named(f.tools, 'create_team_file').execute({ path: 'docs/guide.md', content: 'first line\nsecond line' }, run);
    const search = await named(f.tools, 'search_team_files').execute({ content: 'second' }, run) as { matches: Array<{ path: string; line: number; text: string }> };
    expect(search.matches).toEqual([{ path: 'docs/guide.md', line: 2, text: 'second line' }]);
    const read = await named(f.tools, 'read_team_file').execute({ path: 'docs/guide.md' }, run) as { lines: Array<{ number: number; text: string }> };
    expect(read.lines).toHaveLength(2);
    await named(f.tools, 'edit_team_file').execute({ path: 'docs/guide.md', edits: [{ old: 'first line', new: 'primeira linha' }] }, run);
    const after = await named(f.tools, 'read_team_file').execute({ path: 'docs/guide.md' }, run) as { lines: Array<{ text: string }> };
    expect(after.lines[0]!.text).toBe('primeira linha');
    await named(f.tools, 'delete_team_file').execute({ path: 'docs/guide.md', confirmed: true }, run);
    await expect(named(f.tools, 'read_team_file').execute({ path: 'docs/guide.md' }, run)).rejects.toMatchObject({ code: 'TEAM_FILE_NOT_FOUND' });
  });

  it('keeps the trash out of reach and reports the typed failures on every write', async () => {
    const f = await setupWithFolder();
    const run = exec();
    await named(f.tools, 'create_team_file').execute({ path: 'docs/guide.md', content: 'body' }, run);
    await expect(named(f.tools, 'create_team_file').execute({ path: 'docs/guide.md', content: 'again' }, run)).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
    await expect(named(f.tools, 'edit_team_file').execute({ path: 'docs/guide.md', edits: [{ old: 'absent', new: 'x' }] }, run)).rejects.toMatchObject({ code: 'TEAM_FILE_EDIT_CONFLICT' });
    await expect(named(f.tools, 'delete_team_file').execute({ path: 'docs/guide.md' }, run)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    for (const name of ['read_team_file', 'create_team_file', 'edit_team_file', 'delete_team_file']) {
      const args: Record<string, unknown> = name === 'read_team_file' ? { path: '.trash/docs/guide.md' }
        : name === 'create_team_file' ? { path: '.trash/x.md', content: 'x' }
        : name === 'edit_team_file' ? { path: '.trash/docs/guide.md', edits: [{ old: 'a', new: 'b' }] }
        : { path: '.trash/docs/guide.md', confirmed: true };
      await expect(named(f.tools, name).execute(args, run)).rejects.toMatchObject({ code: 'TEAM_FILE_TRASH_RESERVED' });
    }
    await expect(named(f.tools, 'read_team_file').execute({ path: '../escape.md' }, run)).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
    const search = await named(f.tools, 'search_team_files').execute({}, run) as { paths: Array<{ path: string }> };
    expect(search.paths.some(entry => entry.path.startsWith('.trash'))).toBe(false);
  });

  it('refuses a binary file with an actionable message', async () => {
    const f = await setupWithFolder();
    const run = exec();
    await mkdir(path.join(f.base, 'team-files'), { recursive: true });
    await writeFile(path.join(f.base, 'team-files', 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    await expect(named(f.tools, 'read_team_file').execute({ path: 'diagram.png' }, run)).rejects.toMatchObject({ code: 'TEAM_FILE_BINARY' });
  });

  it('resolves the Hub from the task conversation without a hub_id', async () => {
    const f = await setupWithFolder();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Team docs', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.seen.length = 0;
    await named(f.tools, 'create_team_file').execute({ path: 'docs/from-task.md', content: 'body' }, taskExec(sessionId));
    expect(f.seen).toEqual([f.hub.id]);
    const located = f.app.locator.byTask(task.id);
    expect(located?.hubId).toBe(f.hub.id);
  });
});

describe('team file tools without a usable storage', () => {
  function failing(code: string, message: string): TeamFileStoreSource {
    return { store: () => { throw new KanbanError(code, message); }, exclusive: (_hubId, operation) => operation() };
  }

  it('reports an unbound Hub and an unsupported storage', async () => {
    const unbound = new TeamFiles(failing('TEAM_FILES_UNAVAILABLE', 'This Hub is not connected to a team storage.'));
    const first = await fixture({ teamFiles: unbound });
    fixtures.push(first);
    await expect(named(productToolDefinitions(first.app), 'search_team_files').execute({}, exec())).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });

    const unsupported = new TeamFiles(failing('TEAM_FILES_UNSUPPORTED', 'Team files are unavailable with Google Drive.'));
    const second = await fixture({ teamFiles: unsupported });
    fixtures.push(second);
    await expect(named(productToolDefinitions(second.app), 'read_team_file').execute({ path: 'a.md' }, exec())).rejects.toMatchObject({ code: 'TEAM_FILES_UNSUPPORTED' });
  });

  it('reports a host without the team file dependency', async () => {
    const f = await fixture();
    fixtures.push(f);
    await expect(named(productToolDefinitions(f.app), 'search_team_files').execute({}, exec())).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });
  });
});
