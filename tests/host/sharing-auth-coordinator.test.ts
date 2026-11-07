import { describe, expect, it } from 'vitest';
import { GoogleDriveAuthCoordinator, isAuthorizationCommand, type GoogleDriveAuthPort } from '../../src/host/sharing/auth-coordinator.js';
import type { SharingAuthView } from '../../src/shared/types.js';

class FakeAuth implements GoogleDriveAuthPort {
  readonly calls: string[] = [];
  view: SharingAuthView = { status: 'not-connected' };
  fail?: Error;
  async status(): Promise<SharingAuthView> { return { ...this.view }; }
  async start(): Promise<string> { this.calls.push('start'); this.view = { status: 'authorizing', authorizationUrl: 'https://example.test/consent' }; return 'https://example.test/consent'; }
  async cancel(): Promise<void> { this.calls.push('cancel'); this.view = { status: 'not-connected' }; }
  async disconnect(): Promise<void> { this.calls.push('disconnect'); this.view = { status: 'not-connected' }; }
  async listDrives(): Promise<Array<{ id: string; name: string }>> { this.calls.push('drives'); return [{ id: 'drive-1', name: 'Team' }]; }
  async listFolders(input: { driveId?: string; parentId?: string } = {}): Promise<Array<{ id: string; name: string }>> { this.calls.push('folders:' + (input.driveId ?? 'my-drive')); return [{ id: 'folder-1', name: 'Folder' }]; }
}

function fixture() {
  const auth = new FakeAuth();
  let changes = 0;
  const coordinator = new GoogleDriveAuthCoordinator({ auth, onChange: () => { changes++; } });
  return { auth, coordinator, changes: () => changes };
}

describe('Google Drive authorization coordinator', () => {
  it('starts authorization and publishes the resulting view', async () => {
    const f = fixture();
    await f.coordinator.command({ type: 'sharing.auth.start' });
    expect(f.auth.calls).toEqual(['start']);
    expect(f.coordinator.view()).toMatchObject({ status: 'authorizing', authorizationUrl: 'https://example.test/consent' });
    expect(f.changes()).toBe(1);
  });

  it('routes drive and folder listings with their payloads', async () => {
    const f = fixture();
    await f.coordinator.command({ type: 'sharing.drives' });
    await f.coordinator.command({ type: 'sharing.folders', driveId: 'drive-1' });
    expect(f.auth.calls).toEqual(['drives', 'folders:drive-1']);
  });

  it('serializes authorization actions', async () => {
    const f = fixture();
    const order: string[] = [];
    const original = f.auth.start.bind(f.auth);
    f.auth.start = async () => { order.push('start-enter'); await new Promise(resolve => setTimeout(resolve, 5)); order.push('start-exit'); return original(); };
    await Promise.all([
      f.coordinator.command({ type: 'sharing.auth.start' }),
      f.coordinator.command({ type: 'sharing.auth.disconnect' }),
    ]);
    expect(order).toEqual(['start-enter', 'start-exit']);
    expect(f.auth.calls).toEqual(['start', 'disconnect']);
  });

  it('refuses a connection surface while no account is authorized', async () => {
    const f = fixture();
    await expect(f.coordinator.ensureConnected()).rejects.toMatchObject({ code: 'SHARING_RECONNECT_REQUIRED' });
    f.auth.view = { status: 'connected', email: 'member@example.test' };
    await expect(f.coordinator.ensureConnected()).resolves.toBeUndefined();
    expect(f.coordinator.status()).toBe('connected');
  });

  it('reports an authorization read failure as an error view', async () => {
    const f = fixture();
    f.auth.status = async () => { throw Object.assign(new Error('credential store unavailable'), { code: 'SHARING_AUTH_FAILED' }); };
    await f.coordinator.refresh();
    expect(f.coordinator.view()).toMatchObject({ status: 'error', error: { code: 'SHARING_AUTH_FAILED' } });
  });

  it('cancels on close and refuses later actions', async () => {
    const f = fixture();
    await f.coordinator.close();
    expect(f.auth.calls).toEqual(['cancel']);
    await expect(f.coordinator.command({ type: 'sharing.auth.start' })).rejects.toMatchObject({ code: 'PLUGIN_DISPOSED' });
  });

  it('recognizes exactly the authorization commands', () => {
    expect(isAuthorizationCommand({ type: 'sharing.auth.start' })).toBe(true);
    expect(isAuthorizationCommand({ type: 'sharing.folders' })).toBe(true);
    expect(isAuthorizationCommand({ type: 'sharing.check', hubId: 'hub' })).toBe(false);
  });
});
