import { describe, expect, it } from 'vitest';
import { LocalDriveRequestSchema, LocalDriveResultSchema } from '../../src/remote.js';

const LONG_ROOT = '/' + 'm'.repeat(300);

describe('local Drive remote schema', () => {
  it('accepts mount paths longer than a generic identifier', () => {
    const roots = { action: 'roots', discovery: { state: 'ready', locations: [{ id: LONG_ROOT, rootPath: LONG_ROOT, kind: 'account', status: 'available' }], sources: [{ id: 'cloud-storage', ok: false, reason: 'denied' }] } };
    expect(LocalDriveResultSchema.safeParse(roots).success).toBe(true);
    const page = { action: 'list', page: { rootId: LONG_ROOT, path: LONG_ROOT + '/folder', parent: LONG_ROOT, entries: [{ name: 'folder', path: LONG_ROOT + '/folder' }], hasDocument: false, truncated: false, shown: 1 } };
    expect(LocalDriveResultSchema.safeParse(page).success).toBe(true);
    expect(LocalDriveRequestSchema.safeParse({ action: 'list', path: LONG_ROOT + '/folder' }).success).toBe(true);
  });

  it('rejects a path beyond the supported limit', () => {
    const tooLong = '/' + 'm'.repeat(4096);
    expect(LocalDriveRequestSchema.safeParse({ action: 'list', path: tooLong }).success).toBe(false);
  });
});
