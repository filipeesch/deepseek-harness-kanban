import { describe, expect, it } from 'vitest';
import { buildSharingView } from '../../src/host/sharing/view.js';
import { emptyBoard, type HubSharingRecord } from '../../src/host/sharing/state.js';
import { hubWith, flow } from '../support/sharing-fixtures.js';
import { workflowDigest } from '../../src/domain/sharing/board-plan.js';
import { HubSharingViewSchema } from '../../src/remote.js';

const NOW = '2026-01-01T00:00:00.000Z';

function record(overrides: Partial<HubSharingRecord> = {}): HubSharingRecord {
  return {
    version: 3, hubId: 'hub', binding: { provider: 'local-folder', intervalMinutes: 5, settings: { path: '/team' } },
    providerState: {}, syncedRevision: null,
    base: { token: 't', manifest: { version: 3, boards: [{ key: 'flow', name: 'Flow' }] } },
    seen: { token: 't', manifest: { version: 3, boards: [{ key: 'flow', name: 'Flow' }] } },
    preview: null, bindings: { board: 'flow' }, orphans: {}, removed: {}, pendingRemovals: [],
    boards: { flow: { ...emptyBoard(), published: workflowDigest(flow()) } },
    lastCheck: { at: NOW, token: 't' }, lastSyncedAt: NOW, lastError: null, ...overrides,
  };
}

const provider = { id: 'local-folder' as const, label: 'Local folder', address: '/team', syncMode: 'explicit' as const, defaultIntervalMinutes: 5, requiresAuthorization: false, supportsFiles: true };

describe('sharing view', () => {
  it('reports an unchanged board as in sync', () => {
    const view = buildSharingView(record(), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ boardId: 'board', key: 'flow', state: 'in-sync', bound: true });
    expect(view.drafts).toBe(0);
    expect(view.status).toBe('published');
  });

  it('reports a locally edited board as a draft', () => {
    const view = buildSharingView(record(), hubWith([{ id: 'board', name: 'Flow', workflow: flow(['Local']) }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'draft', pending: true });
    expect(view.drafts).toBe(1);
  });

  it('reports a board with unapplied events as having updates', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), published: workflowDigest(flow()), behind: 2 } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'updates-available', updates: 2 });
    expect(HubSharingViewSchema.safeParse(view).success).toBe(true);
    // The Hub total counts boards, while the board carries its own event count.
    expect(view.updates).toBe(1);
    expect(view.status).toBe('updates-available');
  });

  it('serializes a board that requires a plugin update without an unsafe choice', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), problem: { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'Update the plugin.' } } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'update-required', pending: false });
    expect(view.conflicts).toBe(1); expect(view.status).toBe('needs-review');
    expect(HubSharingViewSchema.safeParse(view).success).toBe(true);
  });

  it('reports a board needing a choice as a review', () => {
    const view = buildSharingView(record({ boards: { flow: { ...emptyBoard(), published: workflowDigest(flow()), conflict: 'identity' } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'needs-review' });
    expect(view.conflicts).toBe(1);
    expect(view.status).toBe('needs-review');
  });

  it('reports a published board this installation does not hold as incoming', () => {
    const view = buildSharingView(record({ bindings: {} }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.incoming).toEqual([{ key: 'flow', name: 'Flow' }]);
    expect(view.updates).toBe(1);
  });

  it('reports a board removed by the team as an orphan', () => {
    const view = buildSharingView(record({ base: { token: 't', manifest: { version: 3, boards: [] } }, seen: { token: 't', manifest: { version: 3, boards: [] } } }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.boards[0]).toMatchObject({ state: 'orphan' });
  });

  it('reports an unpublished Hub as not published', () => {
    const view = buildSharingView(record({ preview: null }), hubWith([{ id: 'board', name: 'Flow' }]), { provider });
    expect(view.status).toBe('published');
  });
});
