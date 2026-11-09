import { describe, expect, it } from 'vitest';
import { boardContentKey, parseSharedDocument, serializeSharedDocument, sharedDocumentToken } from '../../src/domain/sharing/document.js';
import { applySharingPlan } from '../../src/domain/sharing/apply.js';
import { buildUpdatePlan, compareSharing } from '../../src/domain/sharing/plan.js';
import { projectSharingBoards } from '../../src/domain/sharing/projection.js';
import { documentOf, flow, hubWith } from '../support/sharing-fixtures.js';

const deps = { id: (() => { let value = 0; return () => 'created-' + (++value); })(), now: () => '2026-02-01T00:00:00.000Z' };

describe('published project scope', () => {
  it('publishes a restricted board and omits the field for an unrestricted one', () => {
    const text = serializeSharedDocument(documentOf([
      { key: 'a', name: 'A', workflow: flow(), projectKeys: ['api', 'web'] },
      { key: 'b', name: 'B', workflow: flow() },
    ]));
    const parsed = parseSharedDocument(text);
    expect(parsed.boards[0]!.projectKeys).toEqual(['api', 'web']);
    expect(parsed.boards[1]!.projectKeys).toBeUndefined();
    expect(text.match(/projectKeys/g)).toHaveLength(1);
  });

  it('publishes a closed board as an empty list', () => {
    const parsed = parseSharedDocument(serializeSharedDocument(documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: [] }])));
    expect(parsed.boards[0]!.projectKeys).toEqual([]);
  });

  it('reads a version one document as boards without a scope', () => {
    const v1 = serializeSharedDocument(documentOf([{ key: 'a', name: 'A', workflow: flow() }])).replace(/^version: 2/, 'version: 1');
    const parsed = parseSharedDocument(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.boards[0]!.projectKeys).toBeUndefined();
  });

  it('refuses a document written by a newer plugin version, even when its shape is unknown', () => {
    expect(() => parseSharedDocument('version: 3\nboards: []\n')).toThrow(/newer plugin version/i);
    expect(() => parseSharedDocument('version: 3\nboards: []\nnewFormatField: true\n')).toThrow(/newer plugin version/i);
  });

  it('rejects a published project key that the local key contract refuses', () => {
    const text = serializeSharedDocument(documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['api'] }])).replace('api', 'INVALID KEY!');
    expect(() => parseSharedDocument(text)).toThrow(/invalid/i);
  });

  it('treats a differently ordered scope as the same content', () => {
    const one = documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['api', 'web'] }]);
    const same = documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['web', 'api', 'api'] }]);
    expect(sharedDocumentToken(one)).toBe(sharedDocumentToken(same));
    expect(parseSharedDocument(serializeSharedDocument(same)).boards[0]!.projectKeys).toEqual(['api', 'web']);
  });

  it('does not report a conflict for an order-only local scope change', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    hub.boards[0]!.allowedProjectKeys = ['web', 'api'];
    const comparison = compareSharing({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['api', 'web'] }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['api', 'web', 'ops'] }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    // The local scope only reordered keys; the team added one, so applying wins without a conflict.
    expect(comparison.boards[0]!.decision).toBe('updates-available');
  });

  it('changes the token and the content key when only the scope changes', () => {
    const open = documentOf([{ key: 'a', name: 'A', workflow: flow() }]);
    const restricted = documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['api'] }]);
    const closed = documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: [] }]);
    expect(sharedDocumentToken(open)).not.toBe(sharedDocumentToken(restricted));
    expect(sharedDocumentToken(open)).not.toBe(sharedDocumentToken(closed));
    expect(sharedDocumentToken(restricted)).not.toBe(sharedDocumentToken(closed));
    expect(boardContentKey(open.boards[0]!)).not.toBe(boardContentKey(closed.boards[0]!));
  });

  it('applies a team scope and holds an unknown key as a placeholder', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['project', 'ops'] }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    applySharingPlan(hub, plan, deps);
    expect(hub.boards[0]!.allowedProjectKeys).toEqual(['ops', 'project']);
    const placeholder = hub.projects.find(project => project.projectKey === 'ops');
    expect(placeholder).toMatchObject({ origin: 'published', name: 'ops' });
    expect(placeholder?.projectPath).toBeUndefined();
  });

  it('creates one placeholder for a key applied twice', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['ops'] }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    applySharingPlan(hub, plan, deps);
    applySharingPlan(hub, plan, deps);
    expect(hub.projects.filter(project => project.projectKey === 'ops')).toHaveLength(1);
  });

  it('clears the scope when the team removes the restriction', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    hub.boards[0]!.allowedProjectKeys = ['project'];
    const plan = buildUpdatePlan({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['project'] }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    applySharingPlan(hub, plan, deps);
    expect(hub.boards[0]!.allowedProjectKeys).toBeUndefined();
  });

  it('requires a per-board choice when both sides changed the scope', () => {
    const hub = hubWith([{ id: 'a', name: 'A' }]);
    hub.boards[0]!.allowedProjectKeys = ['project'];
    const comparison = compareSharing({
      base: documentOf([{ key: 'a', name: 'A', workflow: flow() }]),
      published: documentOf([{ key: 'a', name: 'A', workflow: flow(), projectKeys: ['ops'] }]),
      local: projectSharingBoards(hub, { a: 'a' }),
      bindings: { a: 'a' },
      orphans: {},
      removed: {},
      pendingRemovals: [],
    });
    expect(comparison.boards[0]!.decision).toBe('needs-review');
    expect(comparison.conflicts).toBe(1);
  });
});
