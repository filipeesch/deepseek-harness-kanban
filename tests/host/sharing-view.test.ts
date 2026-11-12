import { describe, expect, it } from 'vitest';
import { buildSharingView } from '../../src/host/sharing/view.js';
import { emptyBoard, emptyRecord, type HubSharingRecord } from '../../src/host/sharing/state.js';
import { hubWith, flow } from '../support/sharing-fixtures.js';
import { HubSharingViewSchema } from '../../src/remote.js';

const NOW = '2026-01-01T00:00:00.000Z';

function record(overrides: Partial<HubSharingRecord> = {}): HubSharingRecord {
  const base = emptyRecord('hub', { provider: 'local-folder', intervalMinutes: 5, settings: { path: '/team' } }, NOW);
  return {
    ...base,
    bindings: { board: 'flow' },
    published: { flow: { key: 'flow', name: 'Flow', rank: 'i', removed: false } },
    boards: { flow: { ...emptyBoard(), seq: 0, head: 'h', probe: 'p', present: true, workflow: flow(), name: 'Flow', rank: 'i' } },
    ...overrides,
  };
}

const provider = { id: 'local-folder' as const, label: 'Local folder', address: '/team', defaultIntervalMinutes: 5, requiresAuthorization: false, supportsFiles: true };

describe('sharing view', () => {
  it('reports an unchanged board as in sync', () => {
    const view = buildSharingView(record(), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ boardId: 'board', key: 'flow', state: 'in-sync', bound: true, draft: false });
    expect(view.drafts).toBe(0);
    expect(view.status).toBe('published');
    expect(view.boards[0]?.detail).toBeUndefined();
  });

  it('reports a locally edited board as a draft with its change summary', () => {
    const view = buildSharingView(record(), hubWith([{ id: 'board', name: 'Flow', workflow: flow(['Local', 'Extra']) }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'draft', draft: true });
    expect(view.drafts).toBe(1);
    expect(view.boards[0]?.detail?.changes.length).toBeGreaterThan(0);
    expect(view.boards[0]?.detail?.local).toBeUndefined();
  });

  it('reports a board with unapplied events as having updates', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), seq: 0, present: true, workflow: flow(), name: 'Flow', rank: 'i', updates: 2 } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'updates-available', updates: 2 });
    expect(HubSharingViewSchema.safeParse(view).success).toBe(true);
    // The Hub total counts boards, while the board carries its own event count.
    expect(view.updates).toBe(1);
    expect(view.status).toBe('updates-available');
  });

  it('serializes a board that requires a plugin update without an unsafe choice', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), present: true, problem: { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'Update the plugin.' } } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'update-required', draft: false });
    expect(view.conflicts).toBe(1);
    expect(view.status).toBe('needs-review');
    expect(HubSharingViewSchema.safeParse(view).success).toBe(true);
  });

  it('reports a board needing a choice as a review that carries both texts', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), present: true, workflow: flow(), name: 'Flow', rank: 'i', conflict: 'identity', incoming: flow(['Team']) } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'needs-review' });
    expect(view.conflicts).toBe(1);
    expect(view.status).toBe('needs-review');
    expect(view.boards[0]?.detail?.local).toBeDefined();
    expect(view.boards[0]?.detail?.team).toContain('Team');
  });

  it('reports a published board this installation does not hold as incoming', () => {
    const view = buildSharingView(record({ published: { flow: { key: 'flow', name: 'Flow', rank: 'i', removed: false }, extra: { key: 'extra', name: 'Extra', rank: 'n', removed: false } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.incoming).toEqual([{ key: 'extra', name: 'Extra' }]);
    expect(view.updates).toBe(1);
  });

  it('reports a board removed by the team as an orphan row', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), present: true, workflow: flow(), removal: true, updates: 1 } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'orphan' });
  });

  it('reports an unpublished Hub with an unbound draft', () => {
    const view = buildSharingView(emptyRecord('hub', { provider: 'local-folder', intervalMinutes: 5, settings: { path: '/team' } }, NOW), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.status).toBe('published');
    expect(view.boards[0]).toMatchObject({ state: 'draft', bound: false });
    expect(view.drafts).toBe(1);
  });

  it('reports a locally removed board that the team still publishes', () => {
    const view = buildSharingView(record({ removed: { flow: { boardId: 'board', name: 'Flow' } }, bindings: {} }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.removed).toEqual([{ key: 'flow', boardId: 'board', name: 'Flow' }]);
  });

  it('carries the connection notice without failing the Hub', () => {
    const view = buildSharingView(record({ notice: { code: 'SHARING_LAYOUT_OUTDATED', message: 'Older layout left untouched.' } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.notice).toEqual({ code: 'SHARING_LAYOUT_OUTDATED', message: 'Older layout left untouched.' });
    expect(view.status).toBe('published');
  });
});
