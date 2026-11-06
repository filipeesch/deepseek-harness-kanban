import { randomUUID } from 'node:crypto';
import { KanbanError } from '../../shared/errors.js';
import { SHARED_DOCUMENT_FILE } from '../../domain/sharing/document.js';

export interface GoogleDriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  parents?: string[];
  driveId?: string;
  trashed?: boolean;
}
export interface GoogleDriveChange {
  fileId?: string;
  removed?: boolean;
  file?: GoogleDriveFile;
}
export interface GoogleDriveClientOptions {
  accessToken: () => Promise<string>;
  /** Force a token refresh after an API 401; the client retries once. */
  refresh?: () => Promise<string>;
  fetch?: typeof fetch;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function statusError(status: number, body: Record<string, unknown>): KanbanError {
  const nested = typeof body.error === 'object' && body.error !== null ? body.error as { message?: unknown; errors?: unknown } : undefined;
  const reasons = Array.isArray(nested?.errors)
    ? nested.errors.flatMap(value => typeof value === 'object' && value !== null && typeof (value as { reason?: unknown }).reason === 'string' ? [(value as { reason: string }).reason] : [])
    : [];
  const message = typeof nested?.message === 'string' ? nested.message : typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Google Drive request failed.';
  const detail = reasons.join(' ') + ' ' + message;
  if (status === 401 || reasons.includes('authError') || reasons.includes('unauthorized')) return new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization expired. Connect the account again.', { status, message, reasons });
  if (reasons.includes('admin_policy_enforced') || /admin_policy|policy/i.test(detail)) return new KanbanError('SHARING_AUTH_POLICY', 'A Google Workspace policy blocked this Drive access.', { status, message, reasons });
  if (reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded') || status === 429) return new KanbanError('SHARING_RATE_LIMITED', 'Google Drive is rate limiting requests. Try again shortly.', { status, message, reasons });
  if (status === 404 || reasons.includes('notFound')) return new KanbanError('SHARING_DOCUMENT_MISSING', 'The Google Drive document or folder no longer exists.', { status, message, reasons });
  if (status === 403 || reasons.includes('insufficientPermissions') || reasons.includes('forbidden')) return new KanbanError('SHARING_PERMISSION', 'The connected Google account cannot access this Drive location.', { status, message, reasons });
  if (status >= 500 || reasons.includes('backendError') || reasons.includes('internalError')) return new KanbanError('SHARING_UNAVAILABLE', 'Google Drive is unavailable right now.', { status, message, reasons });
  return new KanbanError('SHARING_FAILED', message, { status, reasons });
}

/**
 * Small Drive v3 client. It owns HTTP mechanics and error mapping only; the
 * provider decides document semantics and the sync coordinator decides timing.
 */
export class GoogleDriveClient {
  private readonly accessToken: () => Promise<string>;
  private readonly refresh: (() => Promise<string>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleDriveClientOptions) {
    this.accessToken = options.accessToken;
    this.refresh = options.refresh;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async send(path: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await this.fetchImpl('https://www.googleapis.com' + path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + token } });
    } catch (error) {
      throw new KanbanError('SHARING_UNREACHABLE', 'Google Drive could not be reached. Check the connection.', { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let token = await this.accessToken();
    let response = await this.send(path, init, token);
    if (response.status === 401 && this.refresh) {
      token = await this.refresh();
      response = await this.send(path, init, token);
    }
    let body: Record<string, unknown> = {};
    try { body = await response.json() as Record<string, unknown>; } catch { /* empty or media response */ }
    if (!response.ok) throw statusError(response.status, body);
    return body;
  }

  async listDrives(): Promise<Array<{ id: string; name: string }>> {
    const body = await this.request('/drive/v3/drives?pageSize=100&fields=drives(id,name)');
    return (Array.isArray(body.drives) ? body.drives : []).flatMap(value => typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' ? [{ id: (value as { id: string }).id, name: typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name : 'Shared Drive' }] : []);
  }

  async listFolders(input: { driveId?: string; parentId?: string } = {}): Promise<Array<{ id: string; name: string }>> {
    const parent = input.parentId ?? input.driveId ?? 'root';
    const params = new URLSearchParams({
      q: "'" + parent.replace(/'/g, "\\'") + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name)', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (input.driveId) { params.set('corpora', 'drive'); params.set('driveId', input.driveId); }
    const body = await this.request('/drive/v3/files?' + params.toString());
    return (Array.isArray(body.files) ? body.files : []).flatMap(value => typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' ? [{ id: (value as { id: string }).id, name: typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name : 'Folder' }] : []);
  }

  async getFile(fileId: string): Promise<GoogleDriveFile> {
    const params = new URLSearchParams({ fields: 'id,name,mimeType,headRevisionId,modifiedTime,parents,driveId,trashed', supportsAllDrives: 'true' });
    const body = await this.request('/drive/v3/files/' + encodeURIComponent(fileId) + '?' + params.toString());
    return body as unknown as GoogleDriveFile;
  }

  async getContent(fileId: string): Promise<{ content: string; file: GoogleDriveFile }> {
    const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
    let token = await this.accessToken();
    let response = await this.send('/drive/v3/files/' + encodeURIComponent(fileId) + '?' + params.toString(), {}, token);
    if (response.status === 401 && this.refresh) {
      token = await this.refresh();
      response = await this.send('/drive/v3/files/' + encodeURIComponent(fileId) + '?' + params.toString(), {}, token);
    }
    if (!response.ok) {
      let body: Record<string, unknown> = {};
      try { body = await response.json() as Record<string, unknown>; } catch { /* empty media error */ }
      throw statusError(response.status, body);
    }
    return { content: await response.text(), file: { id: fileId } };
  }

  async findDocument(folderId: string, driveId?: string): Promise<GoogleDriveFile | null> {
    const params = new URLSearchParams({
      q: "name='" + SHARED_DOCUMENT_FILE + "' and '" + folderId.replace(/'/g, "\\'") + "' in parents and trashed=false",
      fields: 'files(id,name,mimeType,headRevisionId,modifiedTime,parents,driveId,trashed)', pageSize: '10', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (driveId) { params.set('corpora', 'drive'); params.set('driveId', driveId); }
    else params.set('corpora', 'allDrives');
    const body = await this.request('/drive/v3/files?' + params.toString());
    const first = Array.isArray(body.files) ? body.files[0] : undefined;
    return typeof first === 'object' && first !== null && typeof (first as { id?: unknown }).id === 'string' ? first as unknown as GoogleDriveFile : null;
  }

  /** Drive's `uploadType=multipart` expects RFC 2387 multipart/related, not multipart/form-data. */
  private multipart(metadata: Record<string, unknown>, content: string): { body: string; contentType: string } {
    const boundary = '----dsh-kanban-' + randomUUID();
    const body = [
      '--' + boundary,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      '--' + boundary,
      'Content-Type: text/yaml; charset=UTF-8',
      '',
      content,
      '--' + boundary + '--',
      '',
    ].join('\r\n');
    return { body, contentType: 'multipart/related; boundary=' + boundary };
  }

  async createDocument(folderId: string, content: string): Promise<GoogleDriveFile> {
    const metadata = { name: SHARED_DOCUMENT_FILE, mimeType: 'text/yaml', parents: [folderId] };
    const params = new URLSearchParams({ uploadType: 'multipart', supportsAllDrives: 'true', fields: 'id,name,mimeType,headRevisionId,modifiedTime,parents,driveId,trashed' });
    const payload = this.multipart(metadata, content);
    return await this.request('/upload/drive/v3/files?' + params.toString(), { method: 'POST', body: payload.body, headers: { 'content-type': payload.contentType } }) as unknown as GoogleDriveFile;
  }

  async updateContent(fileId: string, content: string): Promise<GoogleDriveFile> {
    const metadata = { mimeType: 'text/yaml' };
    const params = new URLSearchParams({ uploadType: 'multipart', supportsAllDrives: 'true', fields: 'id,name,mimeType,headRevisionId,modifiedTime,parents,driveId,trashed' });
    const payload = this.multipart(metadata, content);
    return await this.request('/upload/drive/v3/files/' + encodeURIComponent(fileId) + '?' + params.toString(), { method: 'PATCH', body: payload.body, headers: { 'content-type': payload.contentType } }) as unknown as GoogleDriveFile;
  }

  async getStartPageToken(driveId?: string): Promise<string> {
    const params = new URLSearchParams({ supportsAllDrives: 'true' });
    if (driveId) params.set('driveId', driveId);
    const body = await this.request('/drive/v3/changes/startPageToken?' + params.toString());
    if (typeof body.startPageToken !== 'string') throw new KanbanError('SHARING_FAILED', 'Google Drive did not return a change cursor.');
    return body.startPageToken;
  }

  async listChanges(pageToken: string, driveId?: string): Promise<{ changes: GoogleDriveChange[]; nextPageToken?: string; newStartPageToken?: string }> {
    const params = new URLSearchParams({
      pageToken, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '100',
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,headRevisionId,modifiedTime,parents,trashed))',
    });
    if (driveId) params.set('driveId', driveId);
    const body = await this.request('/drive/v3/changes?' + params.toString());
    return {
      changes: Array.isArray(body.changes) ? body.changes as GoogleDriveChange[] : [],
      ...(typeof body.nextPageToken === 'string' ? { nextPageToken: body.nextPageToken } : {}),
      ...(typeof body.newStartPageToken === 'string' ? { newStartPageToken: body.newStartPageToken } : {}),
    };
  }
}
