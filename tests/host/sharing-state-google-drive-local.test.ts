import { describe, expect, it } from 'vitest';
import { migrateSharingRecord } from '../../src/host/sharing/state.js';

describe('sharing state compatibility', () => {
  it('reads a version 2 record that uses the Google Drive Local storage', () => {
    const record = migrateSharingRecord({
      version: 2,
      hubId: 'hub',
      binding: { provider: 'google-drive-local', intervalMinutes: 1, settings: { path: '/Users/member/Drive/Projetos', mountId: '/Users/member/Drive' } },
      providerState: { mtimeMs: 1, size: 10 },
      syncedRevision: 3,
      base: null,
      seen: null,
      bindings: {},
      orphans: {},
      removed: {},
      pendingRemovals: [],
      preview: null,
      lastCheck: null,
      lastError: null,
    });
    expect(record?.binding).toEqual({ provider: 'google-drive-local', intervalMinutes: 1, settings: { path: '/Users/member/Drive/Projetos', mountId: '/Users/member/Drive' } });
    expect(record?.providerState).toEqual({ mtimeMs: 1, size: 10 });
  });

  it('still rejects an unknown provider', () => {
    const record = migrateSharingRecord({
      version: 2,
      hubId: 'hub',
      binding: { provider: 'dropbox', intervalMinutes: 1, settings: {} },
      providerState: {},
      syncedRevision: null,
      base: null,
      seen: null,
      bindings: {},
      orphans: {},
      removed: {},
      pendingRemovals: [],
      preview: null,
      lastCheck: null,
      lastError: null,
    });
    expect(record).toBeUndefined();
  });
});
