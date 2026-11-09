import type { TeamFileContent, TeamFileEntry, TeamFileReadOptions, TeamFileStore, TeamFileWrite, TeamFileWriteOptions } from './team-file-store.js';

/**
 * A store whose location must be re-proved before every operation. It is how a
 * storage-specific availability rule reaches a provider-agnostic file store
 * without putting that rule, or the storage identifier, into the service.
 */
export class GuardedTeamFileStore implements TeamFileStore {
  constructor(private readonly guard: () => Promise<void>, private readonly inner: TeamFileStore) {}

  async ensure(): Promise<void> { await this.guard(); return this.inner.ensure(); }
  async list(): Promise<TeamFileEntry[]> { await this.guard(); return this.inner.list(); }
  async read(relative: string, options?: TeamFileReadOptions): Promise<TeamFileContent | null> { await this.guard(); return this.inner.read(relative, options); }
  async create(relative: string, content: string): Promise<TeamFileWrite> { await this.guard(); return this.inner.create(relative, content); }
  async write(relative: string, content: string, options: TeamFileWriteOptions): Promise<TeamFileWrite> { await this.guard(); return this.inner.write(relative, content, options); }
  async move(from: string, to: string, options: TeamFileWriteOptions): Promise<{ path: string }> { await this.guard(); return this.inner.move(from, to, options); }
}
