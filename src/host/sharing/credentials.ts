import { credentialKey, type CredentialKey, type CredentialRecord, type CredentialRecordInfo } from '@deepseek-ai/dsh-credentials';
import { KanbanError } from '../../shared/errors.js';

export type { CredentialKey, CredentialRecord, CredentialRecordInfo };

export const GOOGLE_DRIVE_CREDENTIAL_KEY = credentialKey('kanban', 'google-drive');

/**
 * The subset of the host credential seam this plugin depends on. It mirrors
 * the SDK's `CredentialProvider` record contract; `modifyRecord` is the only
 * write path and receives the record as it stands while the write is exclusive.
 */
export interface CredentialStore {
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>;
  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>;
  modifyRecord(key: CredentialKey, mutation: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined>;
  deleteRecord(key: CredentialKey): Promise<void>;
}

/** Resolve the host credential service without making every test provide one. */
export function credentialStoreFromContext(ctx: unknown): CredentialStore | undefined {
  let candidate: Partial<CredentialStore> | undefined;
  try { candidate = (ctx as { credentials?: Partial<CredentialStore> } | undefined)?.credentials; }
  catch { return undefined; }
  if (!candidate) return undefined;
  if (typeof candidate.readRecord !== 'function' || typeof candidate.modifyRecord !== 'function' || typeof candidate.deleteRecord !== 'function') return undefined;
  return candidate as CredentialStore;
}

export function requireCredentialStore(store: CredentialStore | undefined): CredentialStore {
  if (!store) throw new KanbanError('SHARING_CREDENTIALS_UNAVAILABLE', 'The host credential store is not available, so Google Drive cannot be connected.');
  return store;
}
