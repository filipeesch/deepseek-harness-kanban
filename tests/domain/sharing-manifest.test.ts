import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import {
  boardContentKey, boardLogPath, readSharedConfiguration, sameSharedManifest,
  serializeSharedManifest, sharedManifestToken, SHARED_MANIFEST_VERSION,
} from '../../src/domain/sharing/manifest.js';

const NL = String.fromCharCode(10);

describe('published hub manifest', () => {
  it('reads a manifest with its board order and project scopes', () => {
    const read = readSharedConfiguration([
      'version: 3',
      'boards:',
      '  - key: delivery',
      '    name: Delivery',
      '    projectKeys: [app, ops]',
      '  - key: ops',
      '    name: Ops',
      '',
    ].join(NL));
    expect(read.manifest.version).toBe(SHARED_MANIFEST_VERSION);
    expect(read.manifest.boards.map(board => board.key)).toEqual(['delivery', 'ops']);
    expect(read.manifest.boards[0]?.projectKeys).toEqual(['app', 'ops']);
    expect(read.manifest.boards[1]?.projectKeys).toBeUndefined();
    expect(read.legacyWorkflows).toEqual({});
    expect(read.sourceVersion).toBe(3);
  });

  it('round-trips through its own text with a stable token', () => {
    const manifest = { version: SHARED_MANIFEST_VERSION as 3, boards: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B', projectKeys: [] as string[] }] };
    const text = serializeSharedManifest(manifest);
    const read = readSharedConfiguration(text);
    expect(read.manifest).toEqual(manifest);
    expect(sameSharedManifest(read.manifest, manifest)).toBe(true);
    expect(sharedManifestToken(read.manifest)).toBe(sharedManifestToken(manifest));
    expect(sharedManifestToken({ ...manifest, boards: [...manifest.boards].reverse() })).not.toBe(sharedManifestToken(manifest));
  });

  it('normalizes a version 2 document into entries and genesis board workflows', () => {
    const read = readSharedConfiguration([
      'version: 2',
      'boards:',
      '  - key: delivery',
      '    name: Delivery',
      '    workflow: |',
      '      columns:',
      '        - id: backlog',
      '          label: Backlog',
      '        - id: done',
      '          label: Done',
      '    projectKeys: [app]',
      '',
    ].join(NL));
    expect(read.sourceVersion).toBe(2);
    expect(read.manifest.boards).toEqual([{ key: 'delivery', name: 'Delivery', projectKeys: ['app'] }]);
    const workflow = parseWorkflow(read.legacyWorkflows.delivery!);
    expect(workflow.columns.map(column => [column.id, column.key])).toEqual([['backlog', 'backlog'], ['done', 'done']]);
  });

  it('drops the project scopes a version 1 document never defined', () => {
    const read = readSharedConfiguration([
      'version: 1',
      'boards:',
      '  - key: delivery',
      '    name: Delivery',
      '    workflow: |',
      '      columns:',
      '        - id: backlog',
      '          label: Backlog',
      '    projectKeys: [app]',
      '',
    ].join(NL));
    expect(read.manifest.boards[0]?.projectKeys).toBeUndefined();
  });

  it('refuses a configuration from a newer plugin instead of guessing', () => {
    expect(() => readSharedConfiguration('version: 9' + NL + 'boards: []' + NL)).toThrow(expect.objectContaining({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' }));
  });

  it('rejects a repeated board key or name, and an invalid legacy workflow', () => {
    expect(() => readSharedConfiguration('version: 3' + NL + 'boards: [{key: a, name: A}, {key: a, name: B}]' + NL)).toThrow(expect.objectContaining({ code: 'SHARING_INVALID_DOCUMENT' }));
    expect(() => readSharedConfiguration('version: 3' + NL + 'boards: [{key: a, name: Same}, {key: b, name: " Same "}]' + NL)).toThrow(expect.objectContaining({ code: 'SHARING_INVALID_DOCUMENT' }));
    expect(() => readSharedConfiguration('version: 2' + NL + 'boards: [{key: a, name: A, workflow: "columns: []"}]' + NL)).toThrow(expect.objectContaining({ code: 'SHARING_INVALID_DOCUMENT' }));
    expect(() => readSharedConfiguration('version: 3' + NL + 'boards: [{key: "../escape", name: A}]' + NL)).toThrow(expect.objectContaining({ code: 'SHARING_INVALID_DOCUMENT' }));
  });

  it('names one log per board and one content key per entry', () => {
    expect(boardLogPath('delivery')).toBe('kanban-boards/delivery.yaml');
    expect(boardContentKey({ name: 'A', projectKeys: ['b', 'a'] })).toBe(boardContentKey({ name: 'A', projectKeys: ['a', 'a', 'b'] }));
    expect(boardContentKey({ name: 'A' })).not.toBe(boardContentKey({ name: 'A', projectKeys: [] }));
  });
});
