import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SharingAuthView } from '../../shared/types.js';
import { KanbanError } from '../../shared/errors.js';
import { GOOGLE_DRIVE_CREDENTIAL_KEY, requireCredentialStore, type CredentialRecord, type CredentialStore } from './credentials.js';
import { GoogleDriveClient } from './google-drive-client.js';

export const DEFAULT_GOOGLE_DRIVE_CLIENT_ID = '542662301814-0ientrpp3q20vb1ld5v5p6td4fjgct50.apps.googleusercontent.com';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const STATE_TTL_MS = 5 * 60_000;

interface GrantPayload {
  access: string;
  refresh?: string;
  expiresAt: number;
  scope: string;
  email?: string;
  tokenType?: string;
}
interface PendingFlow {
  state: string;
  verifier: string;
  redirectUri: string;
  startedAt: number;
  server: Server;
  timer?: ReturnType<typeof setTimeout>;
  generation: number;
}

export interface GoogleDriveAuthOptions {
  credentials?: CredentialStore;
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => void;
}

function base64url(value: Buffer): string { return value.toString('base64url'); }
function verifier(): string { return base64url(randomBytes(48)); }
function challenge(value: string): string { return base64url(createHash('sha256').update(value).digest()); }

function grantOf(record: CredentialRecord | undefined): GrantPayload | undefined {
  if (!record || record.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return undefined;
  const value = record.payload as Partial<GrantPayload>;
  if (typeof value.access !== 'string' || typeof value.expiresAt !== 'number' || typeof value.scope !== 'string') return undefined;
  return value as GrantPayload;
}

/**
 * Installed-application OAuth for Google Drive. The browser signs in on
 * Google, the loopback callback lands here, and the grant lives in the host
 * credential store; no token ever reaches the client.
 */
export class GoogleDriveAuthService {
  private readonly credentials: CredentialStore | undefined;
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly onChange: (() => void) | undefined;
  private pending: PendingFlow | undefined;
  private generation = 0;
  private reconnectRequired = false;
  private lastError: { code: string; message: string } | undefined;
  private drives: Array<{ id: string; name: string }> = [];
  private folders: Array<{ id: string; name: string }> = [];

  constructor(options: GoogleDriveAuthOptions = {}) {
    this.credentials = options.credentials;
    this.clientId = options.clientId ?? process.env.DSH_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? DEFAULT_GOOGLE_DRIVE_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.DSH_GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.onChange = options.onChange;
  }

  private get store(): CredentialStore { return requireCredentialStore(this.credentials); }

  private notify(): void { this.onChange?.(); }

  /** Begin authorization and return the URL the user must open. */
  async start(): Promise<string> {
    await this.cancel();
    const state = base64url(randomBytes(24));
    const codeVerifier = verifier();
    const server = createServer((request, response) => { void this.handleRequest(request.url ?? '/', response); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const redirectUri = 'http://127.0.0.1:' + port + '/callback';
    const timer = setTimeout(() => { if (this.pending?.state === state) void this.cancel(); }, STATE_TTL_MS);
    timer.unref?.();
    this.generation += 1;
    this.pending = { state, verifier: codeVerifier, redirectUri, startedAt: this.now(), server, timer, generation: this.generation };
    this.lastError = undefined;
    this.reconnectRequired = false;
    this.notify();
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile ' + GOOGLE_DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async cancel(): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    this.generation += 1;
    if (pending?.timer) clearTimeout(pending.timer);
    // Do not await close: this runs inside the callback request that the close waits for.
    if (pending) pending.server.close();
    this.notify();
  }

  async disconnect(): Promise<void> {
    await this.cancel();
    this.drives = [];
    this.folders = [];
    try {
      const record = await this.credentials?.readRecord(GOOGLE_DRIVE_CREDENTIAL_KEY);
      const grant = grantOf(record);
      if (grant) await this.revoke(grant.refresh ?? grant.access);
    } catch { /* revocation is best effort */ }
    await this.store.deleteRecord(GOOGLE_DRIVE_CREDENTIAL_KEY);
    this.reconnectRequired = false;
    this.lastError = undefined;
    this.notify();
  }

  /** Complete the loopback callback; public so the acceptance and unit tests can drive it. */
  async handleCallback(code: string, state: string): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new KanbanError('SHARING_AUTH_STATE', 'No Google Drive authorization is in progress.');
    if (state !== pending.state) throw new KanbanError('SHARING_AUTH_STATE', 'The Google Drive authorization state does not match.');
    if (this.now() - pending.startedAt > STATE_TTL_MS) { await this.cancel(); throw new KanbanError('SHARING_AUTH_TIMEOUT', 'The Google Drive authorization timed out. Start again.'); }
    // Consume the flow before any network exchange so a replayed callback cannot
    // exchange the same code twice, and stop accepting new callbacks immediately.
    this.pending = undefined;
    if (pending.timer) clearTimeout(pending.timer);
    pending.server.close();
    const generation = pending.generation;
    try {
      const tokens = await this.tokenRequest(new URLSearchParams({ code, client_id: this.clientId, redirect_uri: pending.redirectUri, grant_type: 'authorization_code', code_verifier: pending.verifier }));
      if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
      const email = await this.userEmail(tokens.access_token);
      if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
      const grant: GrantPayload = { access: tokens.access_token, ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {}), expiresAt: this.now() + (tokens.expires_in ?? 3600) * 1000, scope: GOOGLE_DRIVE_SCOPE, ...(email ? { email } : {}), tokenType: tokens.token_type };
      await this.store.modifyRecord(GOOGLE_DRIVE_CREDENTIAL_KEY, async () => {
        if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
        return { kind: 'grant', payload: grant };
      });
      this.reconnectRequired = false;
      this.lastError = undefined;
      this.notify();
    } catch (error) {
      this.lastError = { code: error instanceof KanbanError ? error.code : 'SHARING_AUTH_FAILED', message: error instanceof Error ? error.message : String(error) };
      this.notify();
      throw error;
    }
  }

  /** A valid access token, refreshed through the credential store when needed. */
  async accessToken(): Promise<string> {
    const record = await this.store.readRecord(GOOGLE_DRIVE_CREDENTIAL_KEY);
    const grant = grantOf(record);
    if (!grant) throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'Google Drive is not authorized. Connect the account again.');
    if (grant.expiresAt > this.now() + 60_000) return grant.access;
    if (!grant.refresh) throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization expired. Connect the account again.');
    let refreshed: GrantPayload | undefined;
    const generation = this.generation;
    try {
    await this.store.modifyRecord(GOOGLE_DRIVE_CREDENTIAL_KEY, async current => {
      const existing = grantOf(current);
      if (!existing) throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'Google Drive is not authorized. Connect the account again.');
      if (existing.expiresAt > this.now() + 60_000) return undefined;
      if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
      const tokens = await this.tokenRequest(new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: existing.refresh ?? '' }));
      if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
      const next: GrantPayload = { ...existing, access: tokens.access_token, expiresAt: this.now() + (tokens.expires_in ?? 3600) * 1000, ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {}) };
      refreshed = next;
      return { kind: 'grant', payload: next };
    });
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'SHARING_RECONNECT_REQUIRED') this.reconnectRequired = true;
      throw error;
    }
    if (!refreshed) {
      const current = grantOf(await this.store.readRecord(GOOGLE_DRIVE_CREDENTIAL_KEY));
      if (current && current.expiresAt > this.now()) return current.access;
      throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization expired. Connect the account again.');
    }
    return refreshed.access;
  }

  /** Force a refresh-token exchange; used after an API 401. */
  async refreshAccessToken(): Promise<string> {
    const generation = this.generation;
    let access: string | undefined;
    try {
      await this.store.modifyRecord(GOOGLE_DRIVE_CREDENTIAL_KEY, async current => {
        const grant = grantOf(current);
        if (!grant?.refresh) throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization expired. Connect the account again.');
        if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
        const tokens = await this.tokenRequest(new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: grant.refresh }));
        if (generation !== this.generation) throw new KanbanError('SHARING_AUTH_CANCELLED', 'The Google Drive authorization was canceled.');
        const next: GrantPayload = { ...grant, access: tokens.access_token, expiresAt: this.now() + (tokens.expires_in ?? 3600) * 1000, ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {}) };
        access = next.access;
        return { kind: 'grant', payload: next };
      });
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'SHARING_RECONNECT_REQUIRED') this.reconnectRequired = true;
      throw error;
    }
    if (access === undefined) throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization expired. Connect the account again.');
    this.reconnectRequired = false;
    return access;
  }

  async status(): Promise<SharingAuthView> {
    if (this.reconnectRequired) return { status: 'reconnect-required', ...(this.lastError ? { error: this.lastError } : {}) };
    if (this.pending) {
      const url = this.authorizationUrlForPending();
      return { status: 'authorizing', ...(url ? { authorizationUrl: url } : {}), ...(this.lastError ? { error: this.lastError } : {}) };
    }
    if (this.lastError) return { status: 'error', error: this.lastError };
    try {
      const info = await this.store.describeRecord(GOOGLE_DRIVE_CREDENTIAL_KEY);
      if (!info.configured) return { status: 'not-connected' };
      const grant = grantOf(await this.store.readRecord(GOOGLE_DRIVE_CREDENTIAL_KEY));
      if (grant) return { status: 'connected', ...(grant.email ? { email: grant.email } : {}), ...(this.drives.length > 0 ? { drives: this.drives } : {}), ...(this.folders.length > 0 ? { folders: this.folders } : {}) };
      this.reconnectRequired = true;
      return { status: 'reconnect-required' };
    } catch (error) {
      return { status: 'error', error: { code: error instanceof KanbanError ? error.code : 'SHARING_AUTH_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
    return { status: 'not-connected' };
  }

  private driveClient(): GoogleDriveClient {
    return new GoogleDriveClient({ accessToken: () => this.accessToken(), refresh: () => this.refreshAccessToken(), fetch: this.fetchImpl });
  }

  async listDrives(): Promise<Array<{ id: string; name: string }>> {
    const drives = await this.driveClient().listDrives();
    this.drives = drives;
    this.notify();
    return drives;
  }

  async listFolders(input: { driveId?: string; parentId?: string } = {}): Promise<Array<{ id: string; name: string }>> {
    const folders = await this.driveClient().listFolders(input);
    this.folders = folders;
    this.notify();
    return folders;
  }

  private authorizationUrlForPending(): string | undefined {
    if (!this.pending) return undefined;
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.pending.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile ' + GOOGLE_DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', this.pending.state);
    url.searchParams.set('code_challenge', challenge(this.pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  private async handleRequest(requestUrl: string, response: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(requestUrl, 'http://127.0.0.1');
    if (url.pathname !== '/callback') { response.statusCode = 404; response.end('Not found'); return; }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error) {
      this.lastError = error === 'admin_policy_enforced'
        ? { code: 'SHARING_AUTH_POLICY', message: 'A Google Workspace policy blocked this authorization.' }
        : { code: 'SHARING_AUTH_DENIED', message: 'Google Drive authorization was denied.' };
      await this.cancel();
      response.end('Authorization was not completed. You can close this tab.');
      return;
    }
    if (!code || !state) { response.statusCode = 400; response.end('Missing authorization code.'); return; }
    try {
      await this.handleCallback(code, state);
      response.end('Google Drive connected. You can close this tab and return to Kanban.');
    } catch (failure) {
      response.statusCode = 400;
      response.end('Google Drive authorization failed. Return to Kanban and try again.');
      this.lastError = { code: failure instanceof KanbanError ? failure.code : 'SHARING_AUTH_FAILED', message: failure instanceof Error ? failure.message : String(failure) };
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; token_type?: string }> {
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const response = await this.fetchImpl(TOKEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    let payload: Record<string, unknown> = {};
    try { payload = await response.json() as Record<string, unknown>; } catch { /* handled below */ }
    if (!response.ok) {
      const detail = typeof payload.error_description === 'string' ? payload.error_description : typeof payload.error === 'string' ? payload.error : 'token exchange failed';
      if (/client_secret/i.test(detail) || (payload.error === 'invalid_request' && !this.clientSecret)) {
        throw new KanbanError('SHARING_AUTH_CLIENT_SECRET', 'Google rejected the authorization because this client requires a client secret. Configure the public client secret or a custom OAuth client.', { detail });
      }
      if (payload.error === 'access_denied') throw new KanbanError('SHARING_AUTH_DENIED', 'Google Drive authorization was denied.', { detail });
      if (payload.error === 'invalid_grant' || payload.error === 'invalid_token') { this.reconnectRequired = true; throw new KanbanError('SHARING_RECONNECT_REQUIRED', 'The Google Drive authorization is no longer valid. Connect the account again.', { detail }); }
      throw new KanbanError('SHARING_AUTH_FAILED', 'Google Drive authorization failed: ' + detail, { detail });
    }
    if (typeof payload.access_token !== 'string') throw new KanbanError('SHARING_AUTH_FAILED', 'Google did not return an access token.');
    return { access_token: payload.access_token, ...(typeof payload.refresh_token === 'string' ? { refresh_token: payload.refresh_token } : {}), ...(typeof payload.expires_in === 'number' ? { expires_in: payload.expires_in } : {}), ...(typeof payload.token_type === 'string' ? { token_type: payload.token_type } : {}) };
  }

  private async userEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await this.fetchImpl(USERINFO_ENDPOINT, { headers: { authorization: 'Bearer ' + accessToken } });
      if (!response.ok) return undefined;
      const payload = await response.json() as { email?: unknown };
      return typeof payload.email === 'string' ? payload.email : undefined;
    } catch { return undefined; }
  }


  private async revoke(token: string): Promise<void> {
    await this.fetchImpl(REVOKE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
  }
}
