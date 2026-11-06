import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveClient } from '../../src/host/sharing/google-drive-client.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function client(fetchImpl: typeof fetch): GoogleDriveClient {
  return new GoogleDriveClient({ accessToken: async () => 'token', fetch: fetchImpl });
}

describe('Google Drive client', () => {
  it('lists shared drives and folders with shared-drive parameters', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return calls.length === 1 ? json({ drives: [{ id: 'drive-1', name: 'Team' }] }) : json({ files: [{ id: 'folder-1', name: 'Hub' }] });
    }) as unknown as typeof fetch;
    const drive = client(fetchImpl);
    expect(await drive.listDrives()).toEqual([{ id: 'drive-1', name: 'Team' }]);
    expect(await drive.listFolders({ driveId: 'drive-1' })).toEqual([{ id: 'folder-1', name: 'Hub' }]);
    expect(calls[0]).toContain('/drive/v3/drives');
    expect(calls[1]).toContain('driveId=drive-1');
    expect(calls[1]).toContain('supportsAllDrives=true');
  });

  it('reads metadata and media', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes('alt=media')
      ? new Response('version: 1\nboards: []\n', { status: 200 })
      : json({ id: 'file-1', name: 'kanban-hub.yaml', headRevisionId: 'r1', parents: ['folder-1'] })) as unknown as typeof fetch;
    const drive = client(fetchImpl);
    expect(await drive.getFile('file-1')).toMatchObject({ id: 'file-1', headRevisionId: 'r1' });
    expect((await drive.getContent('file-1')).content).toContain('version: 1');
  });

  it('maps authorization, permission, missing, rate-limit, and server failures', async () => {
    const cases: Array<[number, string, string]> = [
      [401, 'Unauthorized', 'SHARING_RECONNECT_REQUIRED'],
      [403, 'The user has not granted the app access', 'SHARING_PERMISSION'],
      [403, 'admin_policy_enforced', 'SHARING_AUTH_POLICY'],
      [404, 'File not found', 'SHARING_DOCUMENT_MISSING'],
      [429, 'Rate limit', 'SHARING_RATE_LIMITED'],
      [500, 'Backend error', 'SHARING_UNAVAILABLE'],
    ];
    for (const [status, message, code] of cases) {
      const fetchImpl = vi.fn(async () => json({ message }, status)) as unknown as typeof fetch;
      await expect(client(fetchImpl).getFile('file-1')).rejects.toMatchObject({ code });
    }
  });

  it('decodes nested Google error reasons', async () => {
    const policy = vi.fn(async () => json({ error: { code: 403, message: 'The user is not permitted.', errors: [{ reason: 'admin_policy_enforced' }] } }, 403)) as unknown as typeof fetch;
    await expect(client(policy).getFile('file-1')).rejects.toMatchObject({ code: 'SHARING_AUTH_POLICY' });
    const missing = vi.fn(async () => json({ error: { code: 404, message: 'Not found.', errors: [{ reason: 'notFound' }] } }, 404)) as unknown as typeof fetch;
    await expect(client(missing).getFile('file-1')).rejects.toMatchObject({ code: 'SHARING_DOCUMENT_MISSING' });
  });

  it('decodes nested errors on media downloads', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 403, message: 'Policy blocked.', errors: [{ reason: 'admin_policy_enforced' }] } }, 403)) as unknown as typeof fetch;
    await expect(client(fetchImpl).getContent('file-1')).rejects.toMatchObject({ code: 'SHARING_AUTH_POLICY' });
  });

  it('reports network failure as unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(client(fetchImpl).getFile('file-1')).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
  });

  it('uploads with multipart/related metadata and media parts', async () => {
    let captured: { headers: Record<string, string>; body: string } | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = { headers: init?.headers as Record<string, string>, body: String(init?.body ?? '') };
      return json({ id: 'file-1', name: 'kanban-hub.yaml', headRevisionId: 'r1' });
    }) as unknown as typeof fetch;
    await client(fetchImpl).createDocument('folder-1', 'version: 1\nboards: []\n');
    expect(captured?.headers['content-type']).toMatch(/^multipart\/related; boundary=/);
    expect(captured?.body).toContain('"name":"kanban-hub.yaml"');
    expect(captured?.body).toContain('version: 1');
  });

  it('uses the change feed and start-page-token endpoints', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return String(input).includes('startPageToken') ? json({ startPageToken: 'cursor-1' }) : json({ changes: [{ fileId: 'file-1', file: { id: 'file-1', headRevisionId: 'r2' } }], newStartPageToken: 'cursor-2' });
    }) as unknown as typeof fetch;
    const drive = client(fetchImpl);
    expect(await drive.getStartPageToken('drive-1')).toBe('cursor-1');
    expect(await drive.listChanges('cursor-1', 'drive-1')).toMatchObject({ changes: [{ fileId: 'file-1' }], newStartPageToken: 'cursor-2' });
    expect(calls[1]).toContain('driveId=drive-1');
    expect(calls[1]).toContain('includeItemsFromAllDrives=true');
  });
});
