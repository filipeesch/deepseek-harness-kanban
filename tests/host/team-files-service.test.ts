import { describe, expect, it } from 'vitest';
import { KanbanError } from '../../src/shared/errors.js';
import type { TeamFileContent, TeamFileEntry, TeamFileReadOptions, TeamFileStore, TeamFileStoreResolution, TeamFileStoreSource, TeamFileWrite, TeamFileWriteOptions } from '../../src/host/sharing/team-file-store.js';
import { TeamFiles } from '../../src/host/team-files/service.js';

const NOW = '2026-01-01T00:00:00.000Z';

class MemoryStore implements TeamFileStore {
  readonly files = new Map<string, { bytes: Buffer; modifiedAt: string }>();
  readonly moves: Array<[string, string]> = [];
  readonly writes: string[] = [];
  readCalls = 0;
  headValue: string | undefined;

  seed(relative: string, content: string | Buffer): void {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    this.files.set(relative, { bytes, modifiedAt: NOW });
  }

  content(relative: string): string {
    const value = this.files.get(relative);
    if (value === undefined) throw new Error('Missing seeded file ' + relative);
    return value.bytes.toString('utf8');
  }

  async ensure(): Promise<void> {}
  async list(): Promise<TeamFileEntry[]> {
    return [...this.files.entries()].map(([relative, value]) => ({ path: relative, size: value.bytes.length, modifiedAt: value.modifiedAt }));
  }
  async read(relative: string, options: TeamFileReadOptions = {}): Promise<TeamFileContent | null> {
    this.readCalls += 1;
    const value = this.files.get(relative);
    if (value === undefined) return null;
    if (options.maxBytes !== undefined && value.bytes.length > options.maxBytes) throw new KanbanError('TEAM_FILE_TOO_LARGE', 'Too large.');
    return { path: relative, bytes: value.bytes, size: value.bytes.length, modifiedAt: value.modifiedAt };
  }
  async create(relative: string, content: string): Promise<TeamFileWrite> {
    if (this.files.has(relative)) throw new KanbanError('TEAM_FILE_EXISTS', 'The team file already exists.');
    return this.write(relative, content, { operation: 'create' });
  }
  async write(relative: string, content: string, _options: TeamFileWriteOptions): Promise<TeamFileWrite> {
    const bytes = Buffer.from(content, 'utf8');
    this.files.set(relative, { bytes, modifiedAt: NOW });
    this.writes.push(relative);
    return { path: relative, size: bytes.length };
  }
  async move(from: string, to: string, _options: TeamFileWriteOptions): Promise<{ path: string }> {
    const value = this.files.get(from);
    if (value === undefined) throw new KanbanError('TEAM_FILE_NOT_FOUND', 'The team file does not exist.');
    let destination = to;
    for (let attempt = 2; this.files.has(destination); attempt++) destination = to + '-' + attempt;
    this.moves.push([from, destination]);
    this.files.delete(from);
    this.files.set(destination, value);
    return { path: destination };
  }
  async head(): Promise<string | undefined> { return this.headValue; }
}

/** A source with a real FIFO lane, so serialization is exercised rather than assumed. */
function build(store: MemoryStore = new MemoryStore()): { store: MemoryStore; files: TeamFiles } {
  let tail: Promise<unknown> = Promise.resolve();
  const source: TeamFileStoreSource = {
    store: (): TeamFileStoreResolution => ({ store, provider: 'local-folder', label: 'Local folder', address: '/team' }),
    exclusive: <T>(_hubId: string, operation: () => Promise<T>): Promise<T> => {
      const run = tail.then(operation, operation);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { store, files: new TeamFiles(source) };
}

describe('team file search', () => {
  it('finds paths by pattern, ordered by the store', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'alpha');
    store.seed('docs/b.md', 'beta');
    store.seed('readme.md', 'root');
    const result = await files.search('hub', { path: 'docs/*.md' });
    expect(result.paths.map(entry => entry.path)).toEqual(['docs/a.md', 'docs/b.md']);
    expect(result.matches).toEqual([]);
    expect(result.provider).toBe('local-folder');
    expect(result.address).toBe('/team');
  });

  it('finds text inside the matching files with line numbers', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'first\nTODO: write\nlast');
    store.seed('docs/b.md', 'nothing here');
    const result = await files.search('hub', { path: 'docs/**/*.md', content: 'TODO' });
    expect(result.matches).toEqual([{ path: 'docs/a.md', line: 2, text: 'TODO: write' }]);
  });

  it('searches every candidate, not only the first page, and returns only matching paths', async () => {
    const { store, files } = build();
    for (let index = 0; index < 120; index++) store.seed('docs/' + String(index).padStart(3, '0') + '.md', 'no match here');
    store.seed('docs/zzz.md', 'the needle is here');
    const result = await files.search('hub', { content: 'needle' });
    expect(result.matches.map(match => match.path)).toEqual(['docs/zzz.md']);
    expect(result.paths.map(entry => entry.path)).toEqual(['docs/zzz.md']);
  });

  it('returns an empty result instead of failing when nothing matches', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'alpha');
    const none = await files.search('hub', { content: 'absent' });
    expect(none.matches).toEqual([]);
    expect(none.paths).toEqual([]);
    expect((await files.search('hub', { path: 'nothing/*.md' })).paths).toEqual([]);
  });

  it('bounds the emitted output and reports the byte bound', async () => {
    const { store, files } = build();
    const line = 'x'.repeat(1900) + ' needle';
    store.seed('docs/long.md', Array.from({ length: 60 }, () => line).join('\n'));
    const result = await files.search('hub', { content: 'needle' });
    expect(result.truncated.bytes).toBe(true);
    expect(result.matches.length).toBeLessThan(30);
  });

  it('keeps the serialized search result within the byte budget', async () => {
    const { store, files } = build();
    const line = 'x'.repeat(1900) + ' needle';
    store.seed('docs/long.md', Array.from({ length: 60 }, () => line).join('\n'));
    const result = await files.search('hub', { content: 'needle' });
    expect(result.truncated.bytes).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8')).toBeLessThanOrEqual(50 * 1024 + 2048);
  });

  it('truncates at the path limit only when no content pattern is given', async () => {
    const { store, files } = build();
    for (let index = 0; index < 5; index++) store.seed('doc-' + index + '.md', 'body');
    const result = await files.search('hub', { limit: 2 });
    expect(result.paths).toHaveLength(2);
    expect(result.truncated).toEqual({ paths: true });
    await expect(files.search('hub', { limit: 101 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('skips binary formats and binary payloads even when they contain the text', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'needle in text');
    store.seed('docs/scan.pdf', 'needle inside a pdf');
    store.seed('docs/blob.bin', Buffer.from([0x00, ...Buffer.from('needle inside bytes', 'utf8')]));
    store.headValue = 'abc123';
    const result = await files.search('hub', { content: 'needle' });
    expect(result.matches.map(match => match.path)).toEqual(['docs/a.md']);
    expect(result.head).toBe('abc123');
  });

  it('refuses an empty or absolute path pattern and an empty content pattern', async () => {
    const { files } = build();
    await expect(files.search('hub', { path: '   ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(files.search('hub', { path: '/docs/*.md' })).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
    await expect(files.search('hub', { content: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('team file read', () => {
  it('returns numbered lines, the total count, and the modification time', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'alpha\nbeta\n');
    const result = await files.read('hub', { path: 'docs/a.md' });
    expect(result.lines).toEqual([{ number: 1, text: 'alpha' }, { number: 2, text: 'beta' }]);
    expect(result.totalLines).toBe(2);
    expect(result.modifiedAt).toBe(NOW);
  });

  it('returns the requested window and reports the remaining lines', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'one\ntwo\nthree');
    const result = await files.read('hub', { path: 'docs/a.md', offset: 2, limit: 1 });
    expect(result.lines).toEqual([{ number: 2, text: 'two' }]);
    expect(result.truncatedByLines).toBe(true);
  });

  it('reports a missing file, a binary file, and an oversized file', async () => {
    const { store, files } = build();
    store.seed('docs/diagram.png', Buffer.from([0x89, 0x50, 0x00, 0x4e]));
    await expect(files.read('hub', { path: 'docs/missing.md' })).rejects.toMatchObject({ code: 'TEAM_FILE_NOT_FOUND' });
    await expect(files.read('hub', { path: 'docs/diagram.png' })).rejects.toMatchObject({ code: 'TEAM_FILE_BINARY' });
    store.seed('docs/huge.md', 'x'.repeat(9 * 1024 * 1024));
    await expect(files.read('hub', { path: 'docs/huge.md' })).rejects.toMatchObject({ code: 'TEAM_FILE_TOO_LARGE' });
  });

  it('refuses a path the gate rejects', async () => {
    const { files } = build();
    await expect(files.read('hub', { path: '../secret.md' })).rejects.toMatchObject({ code: 'TEAM_FILE_PATH_INVALID' });
  });
});

describe('team file creation and editing', () => {
  it('creates a file and refuses to replace an existing one', async () => {
    const { store, files } = build();
    const created = await files.create('hub', { path: 'docs/new.md', content: 'hello' });
    expect(created.size).toBe(5);
    expect(store.content('docs/new.md')).toBe('hello');
    await expect(files.create('hub', { path: 'docs/new.md', content: 'again' })).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
    expect(store.content('docs/new.md')).toBe('hello');
  });

  it('lets the transport refuse a replacement the listing never showed', async () => {
    const { store, files } = build();
    store.seed('hidden.md', 'occupied');
    // A listing that omits an existing entry must not make creation unsafe.
    store.list = async () => [];
    await expect(files.create('hub', { path: 'hidden.md', content: 'x' })).rejects.toMatchObject({ code: 'TEAM_FILE_EXISTS' });
    expect(store.content('hidden.md')).toBe('occupied');
  });

  it('creates the same path only once under concurrent callers', async () => {
    const { store, files } = build();
    const settled = await Promise.allSettled([
      files.create('hub', { path: 'docs/race.md', content: 'first' }),
      files.create('hub', { path: 'docs/race.md', content: 'second' }),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? (rejected.reason as KanbanError).code : undefined).toBe('TEAM_FILE_EXISTS');
    expect(store.writes.filter(path => path === 'docs/race.md')).toHaveLength(1);
  });

  it('applies several replacements together and treats the new text literally', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'one two three');
    const result = await files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'one', new: '1' }, { old: 'three', new: '$& $$ $\' $2' }] });
    expect(result.replacements).toBe(2);
    expect(store.content('docs/a.md')).toBe('1 two $& $$ $\' $2');
  });

  it('serializes two edits so one of them conflicts instead of overwriting', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'shared text');
    const settled = await Promise.allSettled([
      files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'shared', new: 'first' }] }),
      files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'shared', new: 'second' }] }),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? (rejected.reason as KanbanError).code : undefined).toBe('TEAM_FILE_EDIT_CONFLICT');
  });

  it('preserves a byte order mark across an unrelated edit', async () => {
    const { store, files } = build();
    store.seed('docs/bom.md', Buffer.from('\uFEFFfirst line\nsecond', 'utf8'));
    await files.edit('hub', { path: 'docs/bom.md', edits: [{ old: 'second', new: 'segunda' }] });
    expect(Buffer.from(store.content('docs/bom.md')).equals(Buffer.from('\uFEFFfirst line\nsegunda', 'utf8'))).toBe(true);
  });

  it('refuses a replacement that is not unique and writes nothing', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'same same');
    await expect(files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'same', new: 'other' }] }))
      .rejects.toMatchObject({ code: 'TEAM_FILE_EDIT_CONFLICT', details: { occurrences: 2 } });
    expect(store.content('docs/a.md')).toBe('same same');
    await expect(files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'absent', new: 'x' }] }))
      .rejects.toMatchObject({ code: 'TEAM_FILE_EDIT_CONFLICT', details: { occurrences: 0 } });
  });

  it('refuses an edit whose result would not read back as text', async () => {
    const { store, files } = build();
    store.seed('docs/a.md', 'plain text');
    await expect(files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'plain', new: 'plain \u0000' }] })).rejects.toMatchObject({ code: 'TEAM_FILE_BINARY' });
    expect(store.content('docs/a.md')).toBe('plain text');
    await expect(files.edit('hub', { path: 'docs/a.md', edits: [{ old: 'plain', new: 'lone \uD800' }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(store.content('docs/a.md')).toBe('plain text');
  });

  it('deletes without loading the file', async () => {
    const { store, files } = build();
    store.seed('docs/notes.md', 'content');
    const before = store.readCalls;
    await files.remove('hub', { path: 'docs/notes.md', confirmed: true });
    expect(store.readCalls).toBe(before);
  });

  it('refuses a missing file, an empty edit list, a non-string replacement, and NUL content', async () => {
    const { files } = build();
    await expect(files.edit('hub', { path: 'docs/missing.md', edits: [{ old: 'a', new: 'b' }] })).rejects.toMatchObject({ code: 'TEAM_FILE_NOT_FOUND' });
    await expect(files.edit('hub', { path: 'docs/missing.md', edits: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(files.edit('hub', { path: 'docs/missing.md', edits: [{ old: 'a', new: 4 as unknown as string }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(files.create('hub', { path: 'docs/nul.md', content: 'a\u0000b' })).rejects.toMatchObject({ code: 'TEAM_FILE_BINARY' });
  });
});

describe('team file deletion', () => {
  it('moves the file into the trash under its original path with a timestamp', async () => {
    const { store, files } = build();
    store.seed('docs/notes.md', 'content');
    const result = await files.remove('hub', { path: 'docs/notes.md', confirmed: true });
    expect(result.trashPath.startsWith('.trash/docs/notes.md.')).toBe(true);
    expect(store.moves).toEqual([['docs/notes.md', result.trashPath]]);
    expect(store.files.has('docs/notes.md')).toBe(false);
    expect(store.files.has(result.trashPath)).toBe(true);
  });

  it('reports the destination the store actually used', async () => {
    const { store, files } = build();
    store.seed('docs/notes.md', 'content');
    store.seed('.trash/docs/notes.md.2000', 'older');
    const first = await files.remove('hub', { path: 'docs/notes.md', confirmed: true });
    expect(store.moves[0]![1]).toBe(first.trashPath);
    expect(first.trashPath).not.toBe('.trash/docs/notes.md.2000');
  });

  it('requires confirmation, a file that exists, and a path outside the trash', async () => {
    const { store, files } = build();
    store.seed('docs/notes.md', 'content');
    await expect(files.remove('hub', { path: 'docs/notes.md' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(files.remove('hub', { path: 'docs/missing.md', confirmed: true })).rejects.toMatchObject({ code: 'TEAM_FILE_NOT_FOUND' });
    await expect(files.remove('hub', { path: '.trash/docs/notes.md', confirmed: true })).rejects.toMatchObject({ code: 'TEAM_FILE_TRASH_RESERVED' });
    expect(store.moves).toEqual([]);
    expect(store.files.has('docs/notes.md')).toBe(true);
  });
});
