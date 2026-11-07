import type { SharingAuthStatus, SharingAuthView, SharingCommand } from '../../shared/types.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import type { GoogleDriveAuthService } from './google-drive-auth.js';

/** The authorization operations the coordinator sequences; the OAuth service satisfies it. */
export interface GoogleDriveAuthPort {
  status(): Promise<SharingAuthView>;
  start(): Promise<string>;
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
  listDrives(): Promise<Array<{ id: string; name: string }>>;
  listFolders(input?: { driveId?: string; parentId?: string }): Promise<Array<{ id: string; name: string }>>;
}

/** The actions a device-level authorization surface can perform. */
export type GoogleDriveAuthAction = 'start' | 'cancel' | 'disconnect' | 'switch' | 'drives' | 'folders';

/** The narrow view of authorization the publishing service depends on. */
export interface SharingAuthorizationPort {
  status(): SharingAuthStatus;
  ensureConnected(): Promise<void>;
  cancel(): Promise<void>;
}

/** A publishing command that belongs to the authorization surface. */
export type AuthorizationCommand = Extract<SharingCommand, { type: 'sharing.auth.start' | 'sharing.auth.cancel' | 'sharing.auth.disconnect' | 'sharing.auth.switch' | 'sharing.drives' | 'sharing.folders' }>;

/** Whether a publishing command belongs to the authorization surface. */
export function isAuthorizationCommand(command: SharingCommand): command is AuthorizationCommand {
  return command.type === 'sharing.auth.start'
    || command.type === 'sharing.auth.cancel'
    || command.type === 'sharing.auth.disconnect'
    || command.type === 'sharing.auth.switch'
    || command.type === 'sharing.drives'
    || command.type === 'sharing.folders';
}

export interface GoogleDriveAuthCoordinatorOptions {
  auth?: GoogleDriveAuthService | GoogleDriveAuthPort;
  onChange?: () => void;
}

/**
 * Owns the Google Drive authorization surface: the current view, the
 * sequential actions, and the cached status other components read. Publishing
 * operations never run inside it, so a slow sign-in cannot block a Hub lane.
 */
export class GoogleDriveAuthCoordinator implements SharingAuthorizationPort {
  private state: SharingAuthView = { status: 'not-connected' };
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: GoogleDriveAuthCoordinatorOptions) {
    if (options.auth === undefined) this.state = { status: 'not-connected' };
  }

  view(): SharingAuthView { return { ...this.state }; }

  status(): SharingAuthStatus { return this.state.status; }

  /** Re-read the authorization state from the credential store. */
  async refresh(): Promise<void> {
    const auth = this.options.auth;
    if (auth === undefined) { this.state = { status: 'not-connected' }; return; }
    try { this.state = await auth.status(); }
    catch (error) { this.state = { status: 'error', error: this.problemOf(error) }; }
  }

  /** Refuse a connection surface that needs an authorized account. */
  async ensureConnected(): Promise<void> {
    await this.refresh();
    invariant(this.state.status === 'connected', 'SHARING_RECONNECT_REQUIRED', 'Connect the account for this team storage before choosing its location.');
  }

  async cancel(): Promise<void> {
    try { await this.options.auth?.cancel(); } catch { /* authorization is best effort on shutdown */ }
  }

  /** Run one authorization action in order and publish the resulting view. */
  command(command: SharingCommand): Promise<void> {
    return this.run(async () => {
      const auth = this.options.auth;
      invariant(auth, 'SHARING_UNAVAILABLE', 'Google Drive authorization is unavailable in this host.');
      if (command.type === 'sharing.auth.start') await auth.start();
      else if (command.type === 'sharing.auth.cancel') await auth.cancel();
      else if (command.type === 'sharing.auth.disconnect') await auth.disconnect();
      else if (command.type === 'sharing.auth.switch') { await auth.disconnect(); await auth.start(); }
      else if (command.type === 'sharing.drives') await auth.listDrives();
      else if (command.type === 'sharing.folders') await auth.listFolders({
        ...(command.driveId === undefined ? {} : { driveId: command.driveId }),
        ...(command.parentId === undefined ? {} : { parentId: command.parentId }),
      });
      else throw new KanbanError('INVALID_INPUT', 'The authorization action is not supported.');
      await this.refresh();
      this.options.onChange?.();
    });
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.cancel();
    await this.tail;
  }

  private problemOf(error: unknown): NonNullable<SharingAuthView['error']> {
    return { code: error instanceof KanbanError ? error.code : 'SHARING_AUTH_FAILED', message: error instanceof Error ? error.message : String(error) };
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.'));
    const execution = this.tail.then(operation);
    this.tail = execution.then(() => undefined, () => undefined);
    return execution;
  }
}
