import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveAuthService } from '../../src/host/sharing/google-drive-auth.js';
import type { CredentialKey, CredentialRecord, CredentialStore } from '../../src/host/sharing/credentials.js';

class MemoryCredentials implements CredentialStore {
  readonly records = new Map<string, CredentialRecord>();
  async readRecord(key: CredentialKey) { return this.records.get(String(key)); }
  async describeRecord(key: CredentialKey) { const record = this.records.get(String(key)); return { configured: record !== undefined, ...(record ? { kind: record.kind, writable: true } : { writable: false }) }; }
  async modifyRecord(key: CredentialKey, mutation: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) { const next = await mutation(this.records.get(String(key))); if (next !== undefined) this.records.set(String(key), next); return next; }
  async deleteRecord(key: CredentialKey) { this.records.delete(String(key)); }
}

function fakeFetch(responses: Array<() => Response>): typeof fetch {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return next();
  }) as unknown as typeof fetch;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('Google Drive authorization', () => {
  it('returns an authorization URL and stores a grant after the loopback callback', async () => {
    const credentials = new MemoryCredentials();
    const auth = new GoogleDriveAuthService({
      credentials, clientId: 'client.apps.googleusercontent.com', now: () => 1_000_000,
      fetch: fakeFetch([
        () => json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, token_type: 'Bearer' }),
        () => json({ email: 'member@example.test' }),
      ]),
    });
    const url = await auth.start();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    const state = parsed.searchParams.get('state')!;
    await auth.handleCallback('code-1', state);
    const grant = credentials.records.get('kanban/google-drive');
    expect(grant?.kind).toBe('grant');
    const payload = grant?.kind === 'grant' ? grant.payload : undefined;
    expect(payload).toMatchObject({ access: 'access-1', refresh: 'refresh-1', email: 'member@example.test' });
    expect((await auth.status()).status).toBe('connected');
  });

  it('refreshes through the credential record without a new sign-in', async () => {
    const credentials = new MemoryCredentials();
    credentials.records.set('kanban/google-drive', { kind: 'grant', payload: { access: 'old', refresh: 'refresh-1', expiresAt: 1, scope: 'drive' } });
    const auth = new GoogleDriveAuthService({
      credentials, clientId: 'client', now: () => 1_000_000,
      fetch: fakeFetch([() => json({ access_token: 'new-access', expires_in: 3600 })]),
    });
    expect(await auth.accessToken()).toBe('new-access');
    const updated = credentials.records.get('kanban/google-drive');
    expect(updated?.kind === 'grant' ? updated.payload : undefined).toMatchObject({ access: 'new-access', refresh: 'refresh-1' });
  });

  it('reports a missing client secret distinctly', async () => {
    const credentials = new MemoryCredentials();
    const auth = new GoogleDriveAuthService({
      credentials, clientId: 'client', now: () => 1_000_000,
      fetch: fakeFetch([() => json({ error: 'invalid_request', error_description: 'client_secret is missing' }, 400)]),
    });
    const url = await auth.start();
    const state = new URL(url).searchParams.get('state')!;
    await expect(auth.handleCallback('code', state)).rejects.toMatchObject({ code: 'SHARING_AUTH_CLIENT_SECRET' });
    expect((await auth.status()).status).toBe('error');
  });

  it('rejects a replayed callback and does not exchange twice', async () => {
    const credentials = new MemoryCredentials();
    const fetchImpl = fakeFetch([
      () => json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
      () => json({ email: 'member@example.test' }),
    ]);
    const auth = new GoogleDriveAuthService({ credentials, clientId: 'client', now: () => 1_000_000, fetch: fetchImpl });
    const state = new URL(await auth.start()).searchParams.get('state')!;
    await auth.handleCallback('code-1', state);
    await expect(auth.handleCallback('code-1', state)).rejects.toMatchObject({ code: 'SHARING_AUTH_STATE' });
  });

  it('does not store a grant when the flow is canceled during the exchange', async () => {
    const credentials = new MemoryCredentials();
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async () => pending) as unknown as typeof fetch;
    const auth = new GoogleDriveAuthService({ credentials, clientId: 'client', now: () => 1_000_000, fetch: fetchImpl });
    const state = new URL(await auth.start()).searchParams.get('state')!;
    const callback = auth.handleCallback('code-1', state);
    await auth.cancel();
    release(json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }));
    await expect(callback).rejects.toMatchObject({ code: 'SHARING_AUTH_CANCELLED' });
    expect(credentials.records.has('kanban/google-drive')).toBe(false);
  });

  it('makes a rejected refresh require reconnect instead of reporting connected', async () => {
    const credentials = new MemoryCredentials();
    credentials.records.set('kanban/google-drive', { kind: 'grant', payload: { access: 'old', refresh: 'refresh-1', expiresAt: 1, scope: 'drive' } });
    const auth = new GoogleDriveAuthService({ credentials, clientId: 'client', now: () => 1_000_000, fetch: fakeFetch([() => json({ error: 'invalid_grant' }, 400)]) });
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'SHARING_RECONNECT_REQUIRED' });
    expect(await auth.status()).toMatchObject({ status: 'reconnect-required' });
  });

  it('does not resurrect a grant when disconnect races a forced refresh', async () => {
    const credentials = new MemoryCredentials();
    credentials.records.set('kanban/google-drive', { kind: 'grant', payload: { access: 'old', refresh: 'refresh-1', expiresAt: 1, scope: 'drive' } });
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const auth = new GoogleDriveAuthService({ credentials, clientId: 'client', now: () => 1_000_000, fetch: (async (input: RequestInfo | URL) => String(input).includes('revoke') ? new Response('', { status: 200 }) : pending) as unknown as typeof fetch });
    const refresh = auth.refreshAccessToken();
    await auth.disconnect();
    release(json({ access_token: 'new', expires_in: 3600 }));
    await expect(refresh).rejects.toMatchObject({ code: 'SHARING_AUTH_CANCELLED' });
    expect(credentials.records.has('kanban/google-drive')).toBe(false);
    expect(await auth.status()).toMatchObject({ status: 'not-connected' });
  });

  it('revokes and removes the grant on disconnect', async () => {
    const credentials = new MemoryCredentials();
    credentials.records.set('kanban/google-drive', { kind: 'grant', payload: { access: 'a', refresh: 'r', expiresAt: 9_999_999, scope: 'drive' } });
    const fetch = fakeFetch([() => new Response('', { status: 200 })]);
    const auth = new GoogleDriveAuthService({ credentials, clientId: 'client', now: () => 1_000_000, fetch });
    await auth.disconnect();
    expect(credentials.records.has('kanban/google-drive')).toBe(false);
  });
});
