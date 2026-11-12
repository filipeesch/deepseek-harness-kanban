import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommandResult } from '../../src/shared/ports.js';
import { GitClone } from '../../src/host/sharing/git-clone.js';
import { GitLayoutStore } from '../../src/host/sharing/layout-git.js';
import { GitTeamFileStore } from '../../src/host/sharing/git-team-file-store.js';
import { serializeLayoutStamp } from '../../src/domain/sharing/layout.js';

const REPOSITORY = 'git@example.com:team/repo.git';
const roots: string[] = [];

async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-git-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

interface Commit { parent: string | null; files: Map<string, string> }

/**
 * A commit-aware Git double. It models a working tree on disk, local and remote
 * branch heads, commit ancestry, and the effect of a hard reset, so a test can
 * prove that a publication happened, that a fast-forward was adopted, and that
 * a rollback really restored the fetched state.
 */
class FakeGit {
  readonly calls: string[][] = [];
  readonly commits = new Map<string, Commit>();
  readonly clonePath: string;
  localHead: string | null = null;
  remoteHead: string | null = null;
  originHead: string | null = null;
  failReset = false;
  failFetch = false;
  beforePush: (() => Promise<void>) | undefined;
  private counter = 0;
  private readonly remoteSnapshot = new Map<string, string>();
  private lastPushed: string | null = null;

  constructor(root: string, hubId = 'hub-1') {
    this.clonePath = path.join(root, hubId);
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.clonePath, '.git'), { recursive: true });
  }

  /** Another machine publishes a change to the remote branch. */
  async remoteCommit(changes: Record<string, string | null>): Promise<void> {
    for (const [relative, content] of Object.entries(changes)) {
      if (content === null) this.remoteSnapshot.delete(relative);
      else this.remoteSnapshot.set(relative, content);
    }
    const sha = 'c' + (++this.counter);
    this.commits.set(sha, { parent: this.remoteHead, files: new Map(this.remoteSnapshot) });
    this.remoteHead = sha;
  }

  private async snapshot(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const relative = prefix.length === 0 ? entry.name : prefix + '/' + entry.name;
        if (entry.isDirectory()) { await walk(path.join(directory, entry.name), relative); continue; }
        if (entry.name.startsWith('.team-file.')) continue;
        files.set(relative, await readFile(path.join(directory, entry.name), 'utf8'));
      }
    };
    await walk(this.clonePath, '');
    return files;
  }

  /** What `git reset --hard` does: restore tracked files, never remove an untracked one. */
  private async restore(files: Map<string, string>, trackedBefore: Map<string, string>): Promise<void> {
    for (const relative of trackedBefore.keys()) if (!files.has(relative)) await unlink(path.join(this.clonePath, relative)).catch(() => undefined);
    for (const [relative, content] of files) {
      const target = path.join(this.clonePath, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
  }

  private sameTree(left: Map<string, string>, right: Map<string, string>): boolean {
    if (left.size !== right.size) return false;
    for (const [relative, content] of left) if (right.get(relative) !== content) return false;
    return true;
  }

  private isAncestor(candidate: string | null, descendant: string | null): boolean {
    let cursor = descendant;
    while (cursor !== null) {
      if (cursor === candidate) return true;
      cursor = this.commits.get(cursor)?.parent ?? null;
    }
    return false;
  }

  run = async (argv: string[]): Promise<CommandResult> => {
    const args = argv.slice(1);
    this.calls.push(args);
    const ok = (stdout = ''): CommandResult => ({ exitCode: 0, stdout, stderr: '' });
    const fail = (stderr: string): CommandResult => ({ exitCode: 1, stdout: '', stderr });
    // The plugin commits with a fixed identity, so `-c key=value` pairs precede the command.
    let start = 0;
    while (args[start] === '-c') start += 2;
    const [command, ...rest] = args.slice(start);
    if (command === 'remote') return ok(REPOSITORY + '\n');
    if (command === 'fetch') {
      if (this.failFetch) return fail('fatal: Authentication failed for ' + REPOSITORY);
      this.originHead = this.remoteHead;
      return ok();
    }
    if (command === 'rev-parse' && rest.includes('refs/remotes/origin/HEAD')) return this.originHead === null ? fail('unknown revision') : ok(this.originHead + '\n');
    if (command === 'rev-parse' && rest.includes('HEAD')) return this.localHead === null ? fail('unknown revision') : ok(this.localHead + '\n');
    if (command === 'symbolic-ref') return ok('origin/main\n');
    if (command === 'status') {
      const head = this.localHead === null ? new Map<string, string>() : this.commits.get(this.localHead)!.files;
      const current = await this.snapshot();
      const dirty = [...head.keys()].filter(relative => current.get(relative) !== head.get(relative));
      return ok(dirty.map(relative => ' M ' + relative).join('\n'));
    }
    if (command === 'show') {
      const spec = rest[0] ?? '';
      const relative = spec.slice(spec.indexOf(':') + 1);
      const commit = this.commits.get(spec.slice(0, spec.indexOf(':')));
      const content = commit?.files.get(relative);
      return content === undefined ? fail("fatal: path '" + relative + "' does not exist in '" + spec + "'") : ok(content);
    }
    if (command === 'reset') {
      if (this.failReset) return fail('fatal: could not reset');
      const target = rest[rest.length - 1] ?? '';
      const commit = this.commits.get(target);
      if (commit === undefined) return fail('fatal: bad revision');
      const trackedBefore = this.localHead === null ? new Map<string, string>() : this.commits.get(this.localHead)!.files;
      this.localHead = target;
      await this.restore(commit.files, trackedBefore);
      return ok();
    }
    if (command === 'add') return ok();
    if (command === 'commit') {
      const current = await this.snapshot();
      const head = this.localHead === null ? new Map<string, string>() : this.commits.get(this.localHead)!.files;
      if (this.sameTree(current, head)) return fail('nothing to commit, working tree clean');
      const sha = 'c' + (++this.counter);
      this.commits.set(sha, { parent: this.localHead, files: current });
      this.localHead = sha;
      return ok();
    }
    if (command === 'push') {
      if (this.beforePush !== undefined) { const hook = this.beforePush; this.beforePush = undefined; await hook(); }
      if (!this.isAncestor(this.remoteHead, this.localHead)) return fail('! [rejected] main -> main (non-fast-forward)');
      this.remoteHead = this.localHead;
      this.lastPushed = this.localHead;
      this.remoteSnapshot.clear();
      for (const [relative, content] of this.commits.get(this.localHead!)!.files) this.remoteSnapshot.set(relative, content);
      return ok();
    }
    return ok();
  };

  commands(): string[] { return this.calls.map(args => args[0] ?? ''); }
  staged(): string[] { return this.calls.filter(args => args[0] === 'add').flatMap(args => args.slice(args.indexOf('--') + 1)); }
  stagedAll(): boolean { return this.calls.some(args => args[0] === 'add' && args.includes('-A')); }
  commitMessage(): string | undefined {
    const commit = this.calls.find(args => args.includes('commit'));
    const index = commit?.indexOf('-m') ?? -1;
    return index === -1 ? undefined : commit![index + 1];
  }
  remoteFiles(): Map<string, string> { return new Map(this.remoteSnapshot); }
  published(): string | null { return this.lastPushed; }
}

async function build(): Promise<{ git: FakeGit; store: GitTeamFileStore; clone: GitClone }> {
  const root = await temporary();
  const git = new FakeGit(root);
  await git.init();
  const clone = new GitClone({ root, hubId: 'hub-1', repository: REPOSITORY, runner: git.run });
  await mkdir(path.join(git.clonePath, 'team-files', 'docs'), { recursive: true });
  await writeFile(path.join(git.clonePath, 'team-files', 'docs', 'a.md'), 'alpha', 'utf8');
  await git.remoteCommit({ 'team-files/docs/a.md': 'alpha' });
  git.originHead = git.remoteHead;
  // Check the clone out at the fetched head, as a completed clone would be.
  await git.run(['git', 'reset', '--hard', '--quiet', git.remoteHead!]);
  return { git, store: new GitTeamFileStore({ clone }), clone };
}

describe('Git team file store', () => {
  it('creates a file through a non-replacing write and publishes it', async () => {
    const { git, store } = await build();
    const created = await store.create('docs/new.md', 'new');
    expect(git.commitMessage()).toBe('create team-files/docs/new.md');
    expect(git.remoteFiles().get('team-files/docs/new.md')).toBe('new');
    expect(created.head).toBe(git.localHead);
    await expect(store.create('docs/new.md', 'again')).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
  });

  it('commits and pushes a write immediately and reports the new head', async () => {
    const { git, store } = await build();
    const written = await store.write('docs/b.md', 'beta', { operation: 'create' });
    expect(git.staged()).toEqual(['team-files/docs/b.md']);
    expect(git.commitMessage()).toBe('create team-files/docs/b.md');
    expect(git.remoteFiles().get('team-files/docs/b.md')).toBe('beta');
    expect(git.published()).toBe(git.localHead);
    expect(written.head).toBe(git.localHead);
  });

  it('adopts the fetched head so an unrelated remote change does not refuse the write', async () => {
    const { git, store } = await build();
    const before = git.localHead;
    await git.remoteCommit({ 'team-files/other.md': 'theirs' });
    const written = await store.write('docs/b.md', 'beta', { operation: 'create' });
    expect(written.head).not.toBe(before);
    expect(git.remoteFiles().get('team-files/other.md')).toBe('theirs');
    expect(git.remoteFiles().get('team-files/docs/b.md')).toBe('beta');
    expect(git.localHead).toBe(git.remoteHead);
  });

  it('refuses a write the team changed and adopts the fetched content', async () => {
    const { git, store } = await build();
    await git.remoteCommit({ 'team-files/docs/a.md': 'theirs' });
    await expect(store.write('docs/a.md', 'mine', { operation: 'edit' })).rejects.toMatchObject({ code: 'TEAM_FILE_CHANGED' });
    // The refusal is recoverable: the clone now holds the team's content.
    expect(await readFile(path.join(git.clonePath, 'team-files', 'docs', 'a.md'), 'utf8')).toBe('theirs');
    expect(git.localHead).toBe(git.originHead);
    expect(git.commitMessage()).toBeUndefined();
  });

  it('returns the clone to the fetched head when the push is refused', async () => {
    const { git, store } = await build();
    const base = git.localHead;
    git.beforePush = async () => { await git.remoteCommit({ 'team-files/other.md': 'late' }); };
    await expect(store.write('docs/b.md', 'beta', { operation: 'create' })).rejects.toMatchObject({
      code: 'TEAM_FILE_CHANGED',
      details: { reset: 'done' },
    });
    expect(git.localHead).toBe(base);
    expect(await readFile(path.join(git.clonePath, 'team-files', 'docs', 'a.md'), 'utf8')).toBe('alpha');
    expect(git.remoteFiles().get('team-files/docs/b.md')).toBeUndefined();
  });

  it('surfaces a failed rollback instead of swallowing it', async () => {
    const { git, store } = await build();
    const base = git.localHead;
    // The damage starts at the rejected push, after the initial adoption reset.
    git.beforePush = async () => { git.failReset = true; await git.remoteCommit({ 'team-files/other.md': 'late' }); };
    await expect(store.create('docs/b.md', 'beta')).rejects.toMatchObject({
      code: 'TEAM_FILE_WRITE_FAILED',
      details: { code: 'SHARING_STALE_TOKEN', reset: 'failed' },
    });
    // The commit exists locally but was never published.
    expect(git.localHead).not.toBe(base);
    expect(git.remoteFiles().get('team-files/docs/b.md')).toBeUndefined();
  });

  it('reports a transport failure during the protocol in the team-file shape', async () => {
    const { git, store } = await build();
    git.failFetch = true;
    await expect(store.write('docs/b.md', 'beta', { operation: 'edit' })).rejects.toMatchObject({
      code: 'TEAM_FILE_WRITE_FAILED',
      details: { code: 'SHARING_AUTH' },
    });
  });

  it('never fetches on a read and reports the commit the clone is at', async () => {
    const { git, store } = await build();
    const content = await store.read('docs/a.md');
    expect(content).not.toBeNull();
    expect(git.commands()).not.toContain('fetch');
    expect(await store.head()).toBe(git.localHead);
  });

  it('stages both sides of a move, names the deletion, and returns where it landed', async () => {
    const { git, store } = await build();
    await mkdir(path.join(git.clonePath, 'team-files', '.trash', 'docs'), { recursive: true });
    await writeFile(path.join(git.clonePath, 'team-files', '.trash', 'docs', 'a.md.2026'), 'older', 'utf8');
    const moved = await store.move('docs/a.md', '.trash/docs/a.md.2026', { operation: 'delete' });
    expect(git.stagedAll()).toBe(true);
    expect(git.commitMessage()).toBe('delete team-files/docs/a.md');
    expect(moved.path).toBe('.trash/docs/a.md.2026-2');
    expect(await readFile(path.join(git.clonePath, 'team-files', '.trash', 'docs', 'a.md.2026-2'), 'utf8')).toBe('alpha');
  });

  it('refreshes the checked-out team files on the automatic document check', async () => {
    const root = await temporary();
    const git = new FakeGit(root);
    await git.init();
    const clone = new GitClone({ root, hubId: 'hub-1', repository: REPOSITORY, runner: git.run });
    await mkdir(path.join(git.clonePath, 'team-files', 'docs'), { recursive: true });
    const document = serializeLayoutStamp();
    await writeFile(path.join(git.clonePath, 'kanban-hub.yaml'), document, 'utf8');
    await writeFile(path.join(git.clonePath, 'team-files', 'docs', 'a.md'), 'alpha', 'utf8');
    await git.remoteCommit({ 'kanban-hub.yaml': document, 'team-files/docs/a.md': 'alpha' });
    git.originHead = git.remoteHead;
    await git.run(['git', 'reset', '--hard', '--quiet', git.remoteHead!]);
    const documents = new GitLayoutStore({ root, hubId: 'hub-1', repository: REPOSITORY, runner: git.run });
    await git.remoteCommit({ 'team-files/docs/a.md': 'refreshed by the check' });
    const snapshot = await documents.readStamp();
    expect(snapshot).not.toBeNull();
    expect(await readFile(path.join(git.clonePath, 'team-files', 'docs', 'a.md'), 'utf8')).toBe('refreshed by the check');
  });
});
